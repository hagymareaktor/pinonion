<?php
/**
 * REST API végpontok a PurePin Review pluginhez.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

add_action( 'rest_api_init', 'kgb_review_register_routes' );

function kgb_review_register_routes() {
    $ns = 'purepin/v1';

    // Pinek – az aktuális oldalhoz
    register_rest_route( $ns, '/pins', [
        [ 'methods' => 'GET',  'callback' => 'kgb_rv_get_pins',   'permission_callback' => '__return_true' ],
        [ 'methods' => 'POST', 'callback' => 'kgb_rv_create_pin', 'permission_callback' => '__return_true' ],
    ] );

    // Egy pin kezelése
    register_rest_route( $ns, '/pins/(?P<id>\d+)', [
        [ 'methods' => 'GET',    'callback' => 'kgb_rv_get_pin',    'permission_callback' => '__return_true' ],
        [ 'methods' => 'PATCH',  'callback' => 'kgb_rv_update_pin', 'permission_callback' => '__return_true' ],
        [ 'methods' => 'DELETE', 'callback' => 'kgb_rv_delete_pin', 'permission_callback' => 'kgb_rv_can_manage' ],
    ] );

    // Kommentek
    register_rest_route( $ns, '/pins/(?P<id>\d+)/comments', [
        [ 'methods' => 'GET',  'callback' => 'kgb_rv_get_comments', 'permission_callback' => '__return_true' ],
        [ 'methods' => 'POST', 'callback' => 'kgb_rv_add_comment',  'permission_callback' => '__return_true' ],
    ] );

    // Olvasottnak jelölés
    register_rest_route( $ns, '/pins/(?P<id>\d+)/read', [
        [ 'methods' => 'POST', 'callback' => 'kgb_rv_mark_read', 'permission_callback' => '__return_true' ],
    ] );

    // Token ellenőrzés
    register_rest_route( $ns, '/verify-token', [
        [ 'methods' => 'POST', 'callback' => 'kgb_rv_verify_token', 'permission_callback' => '__return_true' ],
    ] );

    // Token beállítások olvasása / írása (csak szerkesztők)
    register_rest_route( $ns, '/token', [
        [ 'methods' => 'GET',  'callback' => 'kgb_rv_api_get_token', 'permission_callback' => 'kgb_rv_can_manage' ],
        [ 'methods' => 'POST', 'callback' => 'kgb_rv_api_set_token', 'permission_callback' => 'kgb_rv_can_manage' ],
    ] );
}

// ─── Permission ──────────────────────────────────────────────────────────────

function kgb_rv_can_manage() {
    return current_user_can( 'edit_posts' );
}

// ─── Pinek ───────────────────────────────────────────────────────────────────

function kgb_rv_get_pins( WP_REST_Request $req ) {
    global $wpdb;
    $pt = $wpdb->prefix . 'kgb_pins';
    $ct = $wpdb->prefix . 'kgb_pin_comments';

    $url    = sanitize_text_field( $req->get_param( 'url' ) );
    $status = sanitize_text_field( $req->get_param( 'status' ) );

    if ( $url ) {
        $where = $wpdb->prepare( 'WHERE p.page_url = %s', $url );
    } else {
        $where = 'WHERE 1=1';
    }
    if ( $status && $status !== 'all' ) {
        $where .= $wpdb->prepare( ' AND p.status = %s', $status );
    }

    // phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
    $rows = $wpdb->get_results(
        "SELECT p.*,
            COUNT(c.id)                                        AS comment_count,
            SUM( CASE WHEN c.is_read = 0 THEN 1 ELSE 0 END )  AS unread_count
         FROM $pt p
         LEFT JOIN $ct c ON c.pin_id = p.id
         $where
         GROUP BY p.id
         ORDER BY p.created_at ASC"
    );
    // phpcs:enable

    return rest_ensure_response( $rows );
}

function kgb_rv_create_pin( WP_REST_Request $req ) {
    global $wpdb;
    $pt = $wpdb->prefix . 'kgb_pins';
    $ct = $wpdb->prefix . 'kgb_pin_comments';

    $page_url    = sanitize_text_field( $req->get_param( 'page_url' ) );
    $page_title  = sanitize_text_field( $req->get_param( 'page_title' ) );
    $x_pct       = (float) $req->get_param( 'x_pct' );
    $y_pct       = (float) $req->get_param( 'y_pct' );
    $is_fixed    = $req->get_param( 'is_fixed' )    ? 1 : 0;
    $important   = $req->get_param( 'important' )   ? 1 : 0;
    $author_name = sanitize_text_field( $req->get_param( 'author_name' ) );
    $author_wpid = get_current_user_id();
    $author_ip   = sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? '' );
    $description = sanitize_textarea_field( $req->get_param( 'description' ) );

    if ( ! $page_url || ! $author_name ) {
        return new WP_Error( 'missing', 'Hiányzó mezők', [ 'status' => 400 ] );
    }

    // Névtelen pin engedély ellenőrzés
    if ( ! $author_wpid && ! current_user_can( 'edit_posts' ) && ! kgb_rv_allow_guests() ) {
        return new WP_Error( 'forbidden', 'Névtelen pin nem engedélyezett', [ 'status' => 403 ] );
    }

    // Pin limit ellenőrzés — név + IP alapján (névváltoztatással nem kerülhető meg)
    $limit = (int) kgb_rv_opt( 'pin_limit' );
    if ( $limit > 0 && ! $author_wpid && ! current_user_can( 'edit_posts' ) ) {
        $count = (int) $wpdb->get_var( $wpdb->prepare(
            "SELECT COUNT(*) FROM $pt WHERE page_url = %s AND (author_name = %s OR author_ip = %s) AND author_wp_id = 0",
            $page_url, $author_name, $author_ip
        ) );
        if ( $count >= $limit ) {
            return new WP_Error( 'limit', "Maximum $limit pin engedélyezett oldalanként", [ 'status' => 429 ] );
        }
    }

    $now = current_time( 'mysql' );

    $wpdb->insert( $pt, [
        'page_url'     => $page_url,
        'page_title'   => $page_title,
        'x_pct'        => $x_pct,
        'y_pct'        => $y_pct,
        'status'       => 'open',
        'is_fixed'     => $is_fixed,
        'important'    => $important,
        'author_name'  => $author_name,
        'author_wp_id' => $author_wpid,
        'author_ip'    => $author_ip,
        'description'  => $description,
        'created_at'   => $now,
        'updated_at'   => $now,
    ] );

    $pin_id = (int) $wpdb->insert_id;

    // Email értesítés — új pin
    if ( kgb_rv_opt( 'notify_pin' ) === '1' ) {
        $to      = kgb_rv_opt( 'notify_email' ) ?: get_option( 'admin_email' );
        $subject = '[PurePin Review] Új pin: ' . $page_title;
        $body    = "Új pin érkezett a következő oldalon:\n{$page_url}\n\nSzerző: {$author_name}";
        if ( $description ) $body .= "\nLeírás: {$description}";
        wp_mail( $to, $subject, $body );
    }

    return rest_ensure_response( [ 'id' => $pin_id, 'status' => 'open', 'created_at' => $now ] );
}

function kgb_rv_get_pin( WP_REST_Request $req ) {
    global $wpdb;
    $pin = $wpdb->get_row( $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}kgb_pins WHERE id = %d",
        (int) $req['id']
    ) );
    if ( ! $pin ) {
        return new WP_Error( 'not_found', 'Nem található', [ 'status' => 404 ] );
    }
    return rest_ensure_response( $pin );
}

function kgb_rv_update_pin( WP_REST_Request $req ) {
    global $wpdb;
    $data        = [];
    $status      = sanitize_text_field( $req->get_param( 'status' ) );
    $important   = $req->get_param( 'important' );
    $author_name = sanitize_text_field( $req->get_param( 'author_name' ) );
    $author_wpid = get_current_user_id();

    // ── Státusz jogosultság ──────────────────────────────────────────────────
    if ( $status ) {
        $perm = kgb_rv_opt( 'status_perm' ) ?: 'submitter';
        $is_editor = current_user_can( 'edit_posts' );

        if ( ! $is_editor ) {
            if ( $perm === 'admin_only' ) {
                return new WP_Error( 'forbidden', 'Nincs jogosultságod a státusz módosításához.', [ 'status' => 403 ] );
            }

            // submitter mód: csak saját pin, csak open ↔ done
            if ( $perm === 'submitter' ) {
                $pin_row = $wpdb->get_row( $wpdb->prepare(
                    "SELECT author_wp_id FROM {$wpdb->prefix}kgb_pins WHERE id = %d",
                    (int) $req['id']
                ) );
                $current_uid = get_current_user_id();
                $is_owner    = $current_uid && $pin_row && (int) $pin_row->author_wp_id === $current_uid;

                if ( ! $is_owner ) {
                    return new WP_Error( 'forbidden', 'Csak a saját pined státuszát módosíthatod.', [ 'status' => 403 ] );
                }
                if ( ! in_array( $status, [ 'open', 'done' ], true ) ) {
                    return new WP_Error( 'forbidden', 'Csak Nyitott vagy Kész státuszra állíthatod.', [ 'status' => 403 ] );
                }
            }
        }
    }

    if ( $status && in_array( $status, [ 'open', 'in_progress', 'done' ], true ) ) {
        $data['status'] = $status;
    }
    if ( $important !== null ) {
        $data['important'] = $important ? 1 : 0;
    }

    if ( empty( $data ) ) {
        return new WP_Error( 'no_data', 'Nincs módosítandó adat', [ 'status' => 400 ] );
    }

    // Régi értékek az esemény loghoz
    $pin = $wpdb->get_row( $wpdb->prepare(
        "SELECT status, important FROM {$wpdb->prefix}kgb_pins WHERE id = %d",
        (int) $req['id']
    ) );

    $data['updated_at'] = current_time( 'mysql' );
    $wpdb->update( $wpdb->prefix . 'kgb_pins', $data, [ 'id' => (int) $req['id'] ] );

    if ( $author_name && $pin ) {
        $events = [];
        if ( $status && $status !== $pin->status ) {
            $labels  = [ 'open' => 'Nyitott', 'in_progress' => 'Folyamatban', 'done' => 'Lezárva' ];
            $events[] = 'Státusz: ' . ( $labels[$pin->status] ?? $pin->status ) . ' → ' . ( $labels[$status] ?? $status );
        }
        if ( $important !== null && (int) $important !== (int) $pin->important ) {
            $events[] = $important ? '⭐ Fontosnak jelölve' : 'Fontos jelölés eltávolítva';
        }
        foreach ( $events as $ev ) {
            $wpdb->insert( $wpdb->prefix . 'kgb_pin_comments', [
                'pin_id'       => (int) $req['id'],
                'author_name'  => $author_name,
                'author_wp_id' => $author_wpid,
                'content'      => $ev,
                'type'         => 'event',
                'created_at'   => $data['updated_at'],
                'is_read'      => 1,
            ] );
        }
    }

    return rest_ensure_response( [ 'updated' => true ] );
}

function kgb_rv_delete_pin( WP_REST_Request $req ) {
    global $wpdb;
    $id = (int) $req['id'];
    $wpdb->delete( $wpdb->prefix . 'kgb_pin_comments', [ 'pin_id' => $id ] );
    $wpdb->delete( $wpdb->prefix . 'kgb_pins',         [ 'id'     => $id ] );
    return rest_ensure_response( [ 'deleted' => true ] );
}

// ─── Kommentek ───────────────────────────────────────────────────────────────

function kgb_rv_get_comments( WP_REST_Request $req ) {
    global $wpdb;
    $rows = $wpdb->get_results( $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}kgb_pin_comments WHERE pin_id = %d ORDER BY created_at DESC",
        (int) $req['id']
    ) );
    return rest_ensure_response( $rows );
}

function kgb_rv_add_comment( WP_REST_Request $req ) {
    global $wpdb;

    $author_name = sanitize_text_field( $req->get_param( 'author_name' ) );
    $author_wpid = get_current_user_id();
    $content     = sanitize_textarea_field( $req->get_param( 'content' ) );
    $pin_id      = (int) $req['id'];

    if ( ! $content || ! $author_name ) {
        return new WP_Error( 'missing', 'Hiányzó mezők', [ 'status' => 400 ] );
    }

    // Névtelen komment engedély ellenőrzés
    if ( ! $author_wpid && ! current_user_can( 'edit_posts' ) && ( ! kgb_rv_allow_guests() || kgb_rv_opt( 'allow_guest_comment' ) !== '1' ) ) {
        return new WP_Error( 'forbidden', 'Névtelen komment nem engedélyezett', [ 'status' => 403 ] );
    }

    $now = current_time( 'mysql' );

    // Email értesítés — új komment
    if ( kgb_rv_opt( 'notify_comment' ) === '1' ) {
        $pin = $wpdb->get_row( $wpdb->prepare(
            "SELECT page_url, page_title FROM {$wpdb->prefix}kgb_pins WHERE id = %d", $pin_id
        ) );
        if ( $pin ) {
            $to      = kgb_rv_opt( 'notify_email' ) ?: get_option( 'admin_email' );
            $subject = '[PurePin Review] Új komment a #' . $pin_id . ' pinre';
            $body    = "Új komment érkezett:\nOldal: {$pin->page_url}\nPin: #{$pin_id}\nSzerző: {$author_name}\n\n{$content}";
            wp_mail( $to, $subject, $body );
        }
    }

    $wpdb->insert( $wpdb->prefix . 'kgb_pin_comments', [
        'pin_id'       => $pin_id,
        'author_name'  => $author_name,
        'author_wp_id' => $author_wpid,
        'content'      => $content,
        'type'         => 'comment',
        'created_at'   => $now,
        'is_read'      => 0,
    ] );

    // Frissítjük a pin updated_at-et is
    $wpdb->update(
        $wpdb->prefix . 'kgb_pins',
        [ 'updated_at' => $now ],
        [ 'id' => $pin_id ]
    );

    return rest_ensure_response( [ 'id' => (int) $wpdb->insert_id, 'created_at' => $now ] );
}

function kgb_rv_verify_token( WP_REST_Request $req ) {
    $token  = sanitize_text_field( $req->get_param('token') );
    $stored = kgb_rv_opt('token_value');

    if ( ! $stored || ! kgb_rv_token_enabled() ) {
        return new WP_Error( 'disabled', 'Token védelem nincs bekapcsolva', [ 'status' => 400 ] );
    }

    // Brute-force védelem: max 5 kísérlet / 15 perc / IP
    $ip      = sanitize_text_field( $_SERVER['REMOTE_ADDR'] ?? '' );
    $att_key = 'kgb_rv_tok_' . md5( $ip );
    $attempts = (int) get_transient( $att_key );

    if ( $attempts >= 5 ) {
        return new WP_Error( 'too_many', 'Túl sok sikertelen kísérlet. Várj 15 percet.', [ 'status' => 429 ] );
    }

    if ( ! hash_equals( $stored, $token ) ) {
        set_transient( $att_key, $attempts + 1, 15 * MINUTE_IN_SECONDS );
        sleep(1);
        return new WP_Error( 'invalid', 'Helytelen kód', [ 'status' => 401 ] );
    }

    delete_transient( $att_key );

    // Sikeres: HttpOnly session cookie beállítása
    $cookie_val = wp_hash( $stored . COOKIEHASH );
    setcookie(
        'kgb_rv_access',
        $cookie_val,
        0,           // session cookie (tab bezárásig él)
        COOKIEPATH,
        COOKIE_DOMAIN,
        is_ssl(),
        true         // HttpOnly — JS nem érheti el
    );

    return rest_ensure_response( [ 'ok' => true ] );
}

function kgb_rv_api_get_token() {
    return rest_ensure_response( [
        'enabled' => kgb_rv_token_enabled(),
        'value'   => kgb_rv_opt( 'token_value' ),
    ] );
}

function kgb_rv_api_set_token( WP_REST_Request $req ) {
    $enabled = (bool) $req->get_param( 'enabled' );
    $value   = sanitize_text_field( $req->get_param( 'value' ) ?? '' );

    $opts = get_option( 'kgb_review_settings', [] );
    $opts['token_enabled'] = $enabled ? '1' : '0';
    if ( $value !== '' ) {
        $opts['token_value'] = $value;
    }
    update_option( 'kgb_review_settings', $opts );

    return rest_ensure_response( [
        'ok'      => true,
        'enabled' => $enabled,
        'value'   => $opts['token_value'] ?? '',
    ] );
}

function kgb_rv_mark_read( WP_REST_Request $req ) {
    global $wpdb;
    $wpdb->update(
        $wpdb->prefix . 'kgb_pin_comments',
        [ 'is_read' => 1 ],
        [ 'pin_id'  => (int) $req['id'] ]
    );
    return rest_ensure_response( [ 'ok' => true ] );
}
