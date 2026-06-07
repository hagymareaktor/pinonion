<?php
/**
 * PurePin Review – WP-CLI parancsok
 * Használat: wp purepin <parancs> [opciók]
 */

if ( ! defined( 'ABSPATH' ) ) exit;
if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) return;

WP_CLI::add_command( 'purepin', 'PurePin_CLI' );

class PurePin_CLI {

    /**
     * Pinek listázása.
     *
     * ## OPTIONS
     *
     * [--status=<status>]
     * : Szűrés státuszra: open, in_progress, done, all (alapértelmezett: all)
     *
     * [--url=<url>]
     * : Szűrés oldal URL-re (részleges egyezés is működik)
     *
     * [--important]
     * : Csak fontos pinek
     *
     * [--format=<format>]
     * : Kimenet formátuma: table, json, csv (alapértelmezett: table)
     *
     * ## EXAMPLES
     *
     *     wp purepin list
     *     wp purepin list --status=open
     *     wp purepin list --important --format=json
     *
     * @when after_wp_load
     */
    public function list( $args, $assoc ) {
        global $wpdb;
        $pt = $wpdb->prefix . 'kgb_pins';
        $ct = $wpdb->prefix . 'kgb_pin_comments';

        $where   = 'WHERE 1=1';
        $status  = $assoc['status'] ?? 'all';
        $url     = $assoc['url']    ?? '';

        if ( $status && $status !== 'all' ) {
            $where .= $wpdb->prepare( ' AND p.status = %s', $status );
        }
        if ( $url ) {
            $where .= $wpdb->prepare( ' AND p.page_url LIKE %s', '%' . $wpdb->esc_like( $url ) . '%' );
        }
        if ( isset( $assoc['important'] ) ) {
            $where .= ' AND p.important = 1';
        }

        // phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $rows = $wpdb->get_results(
            "SELECT p.id, p.page_title, p.author_name, p.status,
                    p.important, p.created_at,
                    COUNT(c.id)                                       AS comments,
                    SUM(CASE WHEN c.is_read = 0 AND c.type='comment' THEN 1 ELSE 0 END) AS unread
             FROM $pt p
             LEFT JOIN $ct c ON c.pin_id = p.id
             $where
             GROUP BY p.id
             ORDER BY p.created_at DESC"
        );
        // phpcs:enable

        if ( empty( $rows ) ) {
            WP_CLI::line( 'Nincs találat.' );
            return;
        }

        $format = $assoc['format'] ?? 'table';
        $data   = array_map( function( $r ) {
            return [
                'ID'        => $r->id,
                'Oldal'     => $r->page_title ?: '–',
                'Szerző'    => $r->author_name,
                'Státusz'   => $r->status,
                'Fontos'    => $r->important ? '⭐' : '',
                'Komment'   => $r->comments,
                'Olvasatlan'=> $r->unread ?: 0,
                'Dátum'     => $r->created_at,
            ];
        }, $rows );

        WP_CLI\Utils\format_items( $format, $data,
            [ 'ID', 'Oldal', 'Szerző', 'Státusz', 'Fontos', 'Komment', 'Olvasatlan', 'Dátum' ]
        );
    }

    /**
     * Összefoglaló az összes pinről.
     *
     * ## EXAMPLES
     *
     *     wp purepin summary
     *
     * @when after_wp_load
     */
    public function summary( $args, $assoc ) {
        global $wpdb;
        $pt = $wpdb->prefix . 'kgb_pins';
        $ct = $wpdb->prefix . 'kgb_pin_comments';

        $totals = $wpdb->get_row(
            "SELECT
                COUNT(*)                                    AS total,
                SUM(status='open')                         AS open,
                SUM(status='in_progress')                  AS in_progress,
                SUM(status='done')                         AS done,
                SUM(important=1)                           AS important
             FROM $pt"
        );

        $unread = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM $ct WHERE is_read=0 AND type='comment'"
        );

        $pages = $wpdb->get_results(
            "SELECT page_title, COUNT(*) AS pins,
                    SUM(status!='done') AS open_pins
             FROM $pt
             GROUP BY page_url
             ORDER BY open_pins DESC"
        );

        WP_CLI::line( '' );
        WP_CLI::line( '📌 PurePin Review — összefoglaló' );
        WP_CLI::line( str_repeat( '─', 40 ) );
        WP_CLI::line( sprintf( '  Összes pin:      %d', $totals->total ) );
        WP_CLI::line( sprintf( '  Nyitott:         %d', $totals->open ) );
        WP_CLI::line( sprintf( '  Folyamatban:     %d', $totals->in_progress ) );
        WP_CLI::line( sprintf( '  Lezárt:          %d', $totals->done ) );
        WP_CLI::line( sprintf( '  Fontos:          %d', $totals->important ) );
        WP_CLI::line( sprintf( '  Olvasatlan kom.: %d', $unread ) );
        WP_CLI::line( '' );

        if ( $pages ) {
            WP_CLI::line( '  Oldalak:' );
            foreach ( $pages as $p ) {
                $open = $p->open_pins > 0 ? " ({$p->open_pins} nyitott)" : ' (mind kész)';
                WP_CLI::line( sprintf( '    %-30s  %d pin%s',
                    mb_substr( $p->page_title ?: '–', 0, 30 ), $p->pins, $open ) );
            }
            WP_CLI::line( '' );
        }
    }

    /**
     * Egy pin kommentjeinek listázása.
     *
     * ## OPTIONS
     *
     * <pin_id>
     * : A pin azonosítója
     *
     * ## EXAMPLES
     *
     *     wp purepin comments 42
     *
     * @when after_wp_load
     */
    public function comments( $args, $assoc ) {
        global $wpdb;
        if ( empty( $args[0] ) ) {
            WP_CLI::error( 'Add meg a pin ID-ját: wp purepin comments <id>' );
        }
        $pin_id = (int) $args[0];

        $pin = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}kgb_pins WHERE id = %d", $pin_id
        ) );
        if ( ! $pin ) {
            WP_CLI::error( "Nem található pin #$pin_id" );
        }

        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}kgb_pin_comments WHERE pin_id = %d ORDER BY created_at ASC",
            $pin_id
        ) );

        WP_CLI::line( '' );
        WP_CLI::line( "📌 Pin #{$pin_id} — {$pin->page_title}" );
        WP_CLI::line( "   Státusz: {$pin->status}" . ( $pin->important ? ' ⭐' : '' ) );
        WP_CLI::line( str_repeat( '─', 50 ) );

        foreach ( $rows as $c ) {
            $prefix = $c->type === 'event' ? '  [esemény]' : '  ' . $c->author_name;
            $read   = ( $c->type === 'comment' && ! $c->is_read ) ? ' [olvasatlan]' : '';
            WP_CLI::line( sprintf( '%s  %s%s', $prefix, $c->created_at, $read ) );
            if ( $c->type === 'comment' ) {
                WP_CLI::line( '  ' . $c->content );
            } else {
                WP_CLI::line( '  → ' . $c->content );
            }
            WP_CLI::line( '' );
        }
    }

    /**
     * Komment hozzáadása egy pinhez.
     *
     * ## OPTIONS
     *
     * <pin_id>
     * : A pin azonosítója
     *
     * <szoveg>
     * : A komment szövege
     *
     * [--author=<nev>]
     * : Szerző neve (alapértelmezett: AI Assistant)
     *
     * ## EXAMPLES
     *
     *     wp purepin comment 42 "Javítva, kérlek ellenőrizd"
     *     wp purepin comment 42 "Megvizsgáltam" --author="Claude"
     *
     * @when after_wp_load
     */
    public function comment( $args, $assoc ) {
        global $wpdb;
        if ( count( $args ) < 2 ) {
            WP_CLI::error( 'Használat: wp purepin comment <pin_id> <szöveg>' );
        }

        $pin_id = (int) $args[0];
        $text   = sanitize_textarea_field( $args[1] );
        $author = sanitize_text_field( $assoc['author'] ?? 'AI Assistant' );

        $pin = $wpdb->get_row( $wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}kgb_pins WHERE id = %d", $pin_id
        ) );
        if ( ! $pin ) {
            WP_CLI::error( "Nem található pin #$pin_id" );
        }

        $now = current_time( 'mysql' );
        $wpdb->insert( $wpdb->prefix . 'kgb_pin_comments', [
            'pin_id'       => $pin_id,
            'author_name'  => $author,
            'author_wp_id' => 0,
            'content'      => $text,
            'type'         => 'comment',
            'created_at'   => $now,
            'is_read'      => 0,
        ] );
        $wpdb->update( $wpdb->prefix . 'kgb_pins', [ 'updated_at' => $now ], [ 'id' => $pin_id ] );

        WP_CLI::success( "Komment hozzáadva a #{$pin_id} pinhez." );
    }

    /**
     * Pin státuszának módosítása.
     *
     * ## OPTIONS
     *
     * <pin_id>
     * : A pin azonosítója
     *
     * <status>
     * : Új státusz: open, in_progress, done
     *
     * ## EXAMPLES
     *
     *     wp purepin status 42 done
     *
     * @when after_wp_load
     */
    public function status( $args, $assoc ) {
        global $wpdb;
        if ( count( $args ) < 2 ) {
            WP_CLI::error( 'Használat: wp purepin status <pin_id> <open|in_progress|done>' );
        }

        $pin_id    = (int) $args[0];
        $new_status = $args[1];

        if ( ! in_array( $new_status, [ 'open', 'in_progress', 'done' ], true ) ) {
            WP_CLI::error( 'Érvényes státuszok: open, in_progress, done' );
        }

        $updated = $wpdb->update(
            $wpdb->prefix . 'kgb_pins',
            [ 'status' => $new_status, 'updated_at' => current_time( 'mysql' ) ],
            [ 'id' => $pin_id ]
        );

        if ( ! $updated ) {
            WP_CLI::error( "Nem sikerült frissíteni (pin #{$pin_id} létezik?)" );
        }
        WP_CLI::success( "Pin #{$pin_id} státusza: {$new_status}" );
    }
}
