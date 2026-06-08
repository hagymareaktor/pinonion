<?php
/**
 * REST API endpoints for the PurePin Review plugin.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

add_action( 'rest_api_init', 'purepin_review_register_routes' );

function purepin_review_register_routes() {
    $ns = 'purepin/v1';

    // Pins - for the current page
    register_rest_route( $ns, '/pins', [
        [ 'methods' => 'GET',  'callback' => 'purepin_rv_get_pins',   'permission_callback' => 'is_user_logged_in' ],
        [ 'methods' => 'POST', 'callback' => 'purepin_rv_create_pin', 'permission_callback' => 'is_user_logged_in' ],
    ] );

    // Manage a single pin
    register_rest_route( $ns, '/pins/(?P<id>\d+)', [
        [ 'methods' => 'GET',    'callback' => 'purepin_rv_get_pin',    'permission_callback' => 'is_user_logged_in' ],
        [ 'methods' => 'PATCH',  'callback' => 'purepin_rv_update_pin', 'permission_callback' => 'is_user_logged_in' ],
        [ 'methods' => 'DELETE', 'callback' => 'purepin_rv_delete_pin', 'permission_callback' => 'purepin_rv_can_manage' ],
    ] );

    // Comments
    register_rest_route( $ns, '/pins/(?P<id>\d+)/comments', [
        [ 'methods' => 'GET',  'callback' => 'purepin_rv_get_comments', 'permission_callback' => 'is_user_logged_in' ],
        [ 'methods' => 'POST', 'callback' => 'purepin_rv_add_comment',  'permission_callback' => 'is_user_logged_in' ],
    ] );

    // Mark as read
    register_rest_route( $ns, '/pins/(?P<id>\d+)/read', [
        [ 'methods' => 'POST', 'callback' => 'purepin_rv_mark_read', 'permission_callback' => 'purepin_rv_can_manage' ],
    ] );

    // User UI preferences (for logged in users)
    register_rest_route( $ns, '/prefs', [
        [ 'methods' => 'GET',  'callback' => 'purepin_rv_get_prefs',  'permission_callback' => 'is_user_logged_in' ],
        [ 'methods' => 'POST', 'callback' => 'purepin_rv_save_prefs', 'permission_callback' => 'is_user_logged_in' ],
    ] );
}

// ─── Permission ──────────────────────────────────────────────────────────────

function purepin_rv_can_manage() {
    return purepin_rv_is_developer();
}

// ─── Pins ───────────────────────────────────────────────────────────────────

function purepin_rv_get_pins( WP_REST_Request $req ) {
    global $wpdb;
    $pt = $wpdb->prefix . 'purepin_pins';
    $ct = $wpdb->prefix . 'purepin_pin_comments';

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

    if ( ! purepin_rv_is_developer() ) {
        $where .= $wpdb->prepare( ' AND p.author_wp_id = %d', get_current_user_id() );
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

function purepin_rv_create_pin( WP_REST_Request $req ) {
    global $wpdb;
    $pt = $wpdb->prefix . 'purepin_pins';
    $ct = $wpdb->prefix . 'purepin_pin_comments';

    $page_url       = sanitize_text_field( $req->get_param( 'page_url' ) );
    $page_title     = sanitize_text_field( $req->get_param( 'page_title' ) );
    $x_pct          = (float) $req->get_param( 'x_pct' );
    $y_pct          = (float) $req->get_param( 'y_pct' );
    $is_fixed       = $req->get_param( 'is_fixed' )    ? 1 : 0;
    $important      = $req->get_param( 'important' ) && purepin_rv_is_developer() ? 1 : 0;
    
    $user           = wp_get_current_user();
    $author_name    = $user->display_name ?: $user->user_login;
    $author_wpid    = $user->ID;
    $description    = sanitize_textarea_field( $req->get_param( 'description' ) );
    $viewport_width = (int) $req->get_param( 'viewport_width' );
    $css_selector   = sanitize_text_field( $req->get_param( 'css_selector' ) ?? '' );
    $scroll_context = sanitize_textarea_field( $req->get_param( 'scroll_context' ) ?? '' );

    if ( mb_strlen( $description ) > 1000 ) {
        return new WP_Error( 'too_long', __( 'Failed to save: text is too long (maximum 1000 characters).', 'purepin-review' ), [ 'status' => 400 ] );
    }

    if ( mb_strlen( $css_selector ) > 2000 || mb_strlen( $scroll_context ) > 10000 || mb_strlen( $page_url ) > 2000 ) {
        return new WP_Error( 'payload_too_large', __( 'Payload too large.', 'purepin-review' ), [ 'status' => 400 ] );
    }

    if ( ! $page_url ) {
        return new WP_Error( 'missing', __( 'Missing required fields', 'purepin-review' ), [ 'status' => 400 ] );
    }


    $now = current_time( 'mysql' );

    $wpdb->insert( $pt, [
        'page_url'       => $page_url,
        'page_title'     => $page_title,
        'x_pct'          => $x_pct,
        'y_pct'          => $y_pct,
        'status'         => 'open',
        'is_fixed'       => $is_fixed,
        'important'      => $important,
        'author_name'    => $author_name,
        'author_wp_id'   => $author_wpid,
        'description'    => $description,
        'viewport_width' => $viewport_width,
        'css_selector'   => $css_selector,
        'scroll_context' => $scroll_context,
        'created_at'     => $now,
        'updated_at'     => $now,
    ] );

    $pin_id = (int) $wpdb->insert_id;

    if ($pin_id === 0) {
        return new WP_Error( 'db_error', $wpdb->last_error ?: __( 'Database error.', 'purepin-review' ), [ 'status' => 500 ] );
    }

    return rest_ensure_response( [ 'id' => $pin_id, 'status' => 'open', 'created_at' => $now ] );
}

function purepin_rv_get_pin( WP_REST_Request $req ) {
    global $wpdb;
    $pin = $wpdb->get_row( $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}purepin_pins WHERE id = %d",
        (int) $req['id']
    ) );
    if ( ! $pin ) {
        return new WP_Error( 'not_found', __( 'Not found', 'purepin-review' ), [ 'status' => 404 ] );
    }

    if ( ! purepin_rv_is_developer() && (int) $pin->author_wp_id !== get_current_user_id() ) {
        return new WP_Error( 'forbidden', __( 'You do not have permission to access this pin.', 'purepin-review' ), [ 'status' => 403 ] );
    }

    return rest_ensure_response( $pin );
}

function purepin_rv_update_pin( WP_REST_Request $req ) {
    global $wpdb;
    $data        = [];
    $status      = sanitize_text_field( $req->get_param( 'status' ) );
    $important   = $req->get_param( 'important' );
    $author_name = sanitize_text_field( $req->get_param( 'author_name' ) );
    $author_wpid = get_current_user_id();

    // ── Status permission ──────────────────────────────────────────────────
    if ( $status ) {
        $is_dev = purepin_rv_is_developer();

        if ( ! $is_dev ) {
            $can_client_close = purepin_rv_opt( 'client_can_close' ) === '1';

            if ( ! $can_client_close ) {
                return new WP_Error( 'forbidden', __( 'You do not have permission to change the status.', 'purepin-review' ), [ 'status' => 403 ] );
            }

            // If they can close it, check if it's theirs
            $pin_row = $wpdb->get_row( $wpdb->prepare(
                    "SELECT author_wp_id FROM {$wpdb->prefix}purepin_pins WHERE id = %d",
                    (int) $req['id']
                ) );
                $current_uid = get_current_user_id();
                $is_owner    = $current_uid && $pin_row && (int) $pin_row->author_wp_id === $current_uid;

                if ( ! $is_owner ) {
                    return new WP_Error( 'forbidden', __( 'You can only change the status of your own pins.', 'purepin-review' ), [ 'status' => 403 ] );
                }
                if ( ! in_array( $status, [ 'open', 'done' ], true ) ) {
                    return new WP_Error( 'forbidden', __( 'You can only set the status to Open or Done.', 'purepin-review' ), [ 'status' => 403 ] );
                }
        }
    }

    $description = $req->get_param( 'description' );

    if ( $status && in_array( $status, [ 'open', 'in_progress', 'done' ], true ) ) {
        $data['status'] = $status;
    }
    if ( $important !== null && purepin_rv_is_developer() ) {
        $data['important'] = $important ? 1 : 0;
    }
    if ( $description !== null && purepin_rv_is_developer() ) {
        if ( mb_strlen( $description ) > 1000 ) {
            return new WP_Error( 'too_long', __( 'Failed to save: text is too long (maximum 1000 characters).', 'purepin-review' ), [ 'status' => 400 ] );
        }
        $data['description']            = sanitize_textarea_field( $description );
        $data['description_updated_at'] = current_time( 'mysql' );
    }

    if ( empty( $data ) ) {
        return new WP_Error( 'no_data', __( 'No data to update', 'purepin-review' ), [ 'status' => 400 ] );
    }

    // Old values for the event log
    $pin = $wpdb->get_row( $wpdb->prepare(
        "SELECT status, important FROM {$wpdb->prefix}purepin_pins WHERE id = %d",
        (int) $req['id']
    ) );

    $data['updated_at'] = current_time( 'mysql' );
    $wpdb->update( $wpdb->prefix . 'purepin_pins', $data, [ 'id' => (int) $req['id'] ] );

    if ( $author_name && $pin ) {
        $events = [];
        if ( $status && $status !== $pin->status ) {
            $labels  = [
                'open'        => __( 'Open', 'purepin-review' ),
                'in_progress' => __( 'In Progress', 'purepin-review' ),
                'done'        => __( 'Done', 'purepin-review' ),
            ];
            /* translators: 1: old status label, 2: new status label */
            $events[] = sprintf( __( 'Status: %1$s → %2$s', 'purepin-review' ), $labels[ $pin->status ] ?? $pin->status, $labels[ $status ] ?? $status );
        }
        foreach ( $events as $ev ) {
            $wpdb->insert( $wpdb->prefix . 'purepin_pin_comments', [
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

function purepin_rv_delete_pin( WP_REST_Request $req ) {
    global $wpdb;
    $id = (int) $req['id'];
    $wpdb->delete( $wpdb->prefix . 'purepin_pin_comments', [ 'pin_id' => $id ] );
    $wpdb->delete( $wpdb->prefix . 'purepin_pins',         [ 'id'     => $id ] );
    return rest_ensure_response( [ 'deleted' => true ] );
}

// ─── Comments ───────────────────────────────────────────────────────────────

function purepin_rv_get_comments( WP_REST_Request $req ) {
    global $wpdb;
    $pin_id = (int) $req['id'];

    if ( ! purepin_rv_is_developer() ) {
        $pin_owner = (int) $wpdb->get_var( $wpdb->prepare( "SELECT author_wp_id FROM {$wpdb->prefix}purepin_pins WHERE id = %d", $pin_id ) );
        if ( $pin_owner !== get_current_user_id() ) {
            return new WP_Error( 'forbidden', __( 'You do not have permission to access this pin.', 'purepin-review' ), [ 'status' => 403 ] );
        }
    }

    $rows = $wpdb->get_results( $wpdb->prepare(
        "SELECT * FROM {$wpdb->prefix}purepin_pin_comments WHERE pin_id = %d ORDER BY created_at ASC",
        $pin_id
    ) );
    return rest_ensure_response( $rows );
}

function purepin_rv_add_comment( WP_REST_Request $req ) {
    global $wpdb;

    $user        = wp_get_current_user();
    $author_name = $user->display_name ?: $user->user_login;
    $author_wpid = $user->ID;
    $content     = sanitize_textarea_field( $req->get_param( 'content' ) );
    $pin_id      = (int) $req['id'];

    if ( ! purepin_rv_is_developer() ) {
        $pin_owner = (int) $wpdb->get_var( $wpdb->prepare( "SELECT author_wp_id FROM {$wpdb->prefix}purepin_pins WHERE id = %d", $pin_id ) );
        if ( $pin_owner !== $author_wpid ) {
            return new WP_Error( 'forbidden', __( 'You do not have permission to access this pin.', 'purepin-review' ), [ 'status' => 403 ] );
        }
    }

    if ( ! $content ) {
        return new WP_Error( 'missing', __( 'Missing required fields', 'purepin-review' ), [ 'status' => 400 ] );
    }

    if ( mb_strlen( $content ) > 1000 ) {
        return new WP_Error( 'too_long', __( 'Failed to save: text is too long (maximum 1000 characters).', 'purepin-review' ), [ 'status' => 400 ] );
    }

    $now = current_time( 'mysql' );

    $inserted = $wpdb->insert( $wpdb->prefix . 'purepin_pin_comments', [
        'pin_id'       => $pin_id,
        'author_name'  => $author_name,
        'author_wp_id' => $author_wpid,
        'content'      => $content,
        'type'         => 'comment',
        'created_at'   => $now,
        'is_read'      => 0,
    ] );

    if ( ! $inserted ) {
        return new WP_Error( 'db_error', __( 'Database error.', 'purepin-review' ), [ 'status' => 500 ] );
    }

    // Also update the pin's updated_at
    $wpdb->update(
        $wpdb->prefix . 'purepin_pins',
        [ 'updated_at' => $now ],
        [ 'id' => $pin_id ]
    );

    return rest_ensure_response( [ 'id' => (int) $wpdb->insert_id, 'created_at' => $now ] );
}

function purepin_rv_mark_read( WP_REST_Request $req ) {
    global $wpdb;
    $wpdb->update(
        $wpdb->prefix . 'purepin_pin_comments',
        [ 'is_read' => 1 ],
        [ 'pin_id'  => (int) $req['id'] ]
    );
    return rest_ensure_response( [ 'ok' => true ] );
}

// ─── User preferences ────────────────────────────────────────────────

function purepin_rv_get_prefs() {
    $uid   = get_current_user_id();
    $prefs = get_user_meta( $uid, 'purepin_rv_prefs', true );
    return rest_ensure_response( $prefs ? json_decode( $prefs, true ) : (object)[] );
}

function purepin_rv_save_prefs( WP_REST_Request $req ) {
    $uid     = get_current_user_id();
    $allowed = [ 'activeTab', 'filterImportant', 'filterUnread', 'filterNew', 'scopeFilter', 'sortBy', 'panelOpen' ];
    $body    = $req->get_json_params();
    $prefs   = [];
    foreach ( $allowed as $key ) {
        if ( array_key_exists( $key, $body ) ) {
            $prefs[ $key ] = $body[ $key ];
        }
    }
    update_user_meta( $uid, 'purepin_rv_prefs', wp_json_encode( $prefs ) );
    return rest_ensure_response( [ 'ok' => true ] );
}