<?php
/**
 * PinOnion – WP-CLI commands
 * Usage: wp pinonion <command> [options]
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery
 * phpcs:disable WordPress.DB.DirectDatabaseQuery.NoCaching
 * phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
 * phpcs:disable PluginCheck.Security.DirectDB.UnescapedDBParameter
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}
if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
    return;
}

WP_CLI::add_command( 'pinonion', 'PinOnion_CLI' );

class PinOnion_CLI {

    /**
     * List pins.
     *
     * ## OPTIONS
     *
     * [--status=<status>]
     * : Filter by status: open, in_progress, done, all (default: all)
     *
     * [--url=<url>]
     * : Filter by page URL (partial match works too)
     *
     * [--important]
     * : Only important pins
     *
     * [--format=<format>]
     * : Output format: table, json, csv (default: table)
     *
     * ## EXAMPLES
     *
     *     wp pinonion list
     *     wp pinonion list --status=open
     *     wp pinonion list --important --format=json
     *
     * @when after_wp_load
     */
    public function list( $_args, $assoc ) {
        unset( $_args );
        global $wpdb;
        $pt = $wpdb->prefix . 'pinonion_pins';
        $ct = $wpdb->prefix . 'pinonion_pin_comments';

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
            WP_CLI::line( 'No matches found.' );
            return;
        }

        $format = $assoc['format'] ?? 'table';
        $data   = array_map( function( $r ) {
            return [
                'ID'        => $r->id,
                'Page'      => $r->page_title ?: '–',
                'Author'    => $r->author_name,
                'Status'    => $r->status,
                'Important' => $r->important ? '❗' : '',
                'Comments'  => $r->comments,
                'Unread'    => $r->unread ?: 0,
                'Date'      => $r->created_at,
            ];
        }, $rows );

        WP_CLI\Utils\format_items( $format, $data,
            [ 'ID', 'Page', 'Author', 'Status', 'Important', 'Comments', 'Unread', 'Date' ]
        );
    }

    /**
     * Summary of all pins.
     *
     * ## EXAMPLES
     *
     *     wp pinonion summary
     *
     * @when after_wp_load
     */
    public function summary( $_args, $_assoc ) {
        unset( $_args, $_assoc );
        global $wpdb;
        $pt = $wpdb->prefix . 'pinonion_pins';
        $ct = $wpdb->prefix . 'pinonion_pin_comments';

        // phpcs:disable PluginCheck.Security.DirectDB.UnescapedDBParameter, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
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
        // phpcs:enable

        WP_CLI::line( '' );
        WP_CLI::line( '📌 PinOnion — summary' );
        WP_CLI::line( str_repeat( '─', 40 ) );
        WP_CLI::line( sprintf( '  Total pins:      %d', $totals->total ) );
        WP_CLI::line( sprintf( '  Open:            %d', $totals->open ) );
        WP_CLI::line( sprintf( '  In progress:     %d', $totals->in_progress ) );
        WP_CLI::line( sprintf( '  Done:            %d', $totals->done ) );
        WP_CLI::line( sprintf( '  Important:       %d', $totals->important ) );
        WP_CLI::line( sprintf( '  Unread comments: %d', $unread ) );
        WP_CLI::line( '' );

        if ( $pages ) {
            WP_CLI::line( '  Pages:' );
            foreach ( $pages as $p ) {
                $open = $p->open_pins > 0 ? " ({$p->open_pins} open)" : ' (all done)';
                WP_CLI::line( sprintf( '    %-30s  %d pin%s',
                    mb_substr( $p->page_title ?: '–', 0, 30 ), $p->pins, $open ) );
            }
            WP_CLI::line( '' );
        }
    }

    /**
     * List comments of a pin.
     *
     * ## OPTIONS
     *
     * <pin_id>
     * : The ID of the pin
     *
     * ## EXAMPLES
     *
     *     wp pinonion comments 42
     *
     * @when after_wp_load
     */
    public function comments( $args, $_assoc ) {
        unset( $_assoc );
        global $wpdb;
        if ( empty( $args[0] ) ) {
            WP_CLI::error( 'Provide the pin ID: wp pinonion comments <id>' );
        }
        $pin_id = (int) $args[0];

        $pin = $wpdb->get_row( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}pinonion_pins WHERE id = %d", $pin_id
        ) );
        if ( ! $pin ) {
            WP_CLI::error( "Pin #$pin_id not found" );
        }

        $rows = $wpdb->get_results( $wpdb->prepare(
            "SELECT * FROM {$wpdb->prefix}pinonion_pin_comments WHERE pin_id = %d ORDER BY created_at ASC",
            $pin_id
        ) );

        WP_CLI::line( '' );
        WP_CLI::line( "📌 Pin #{$pin_id} — {$pin->page_title}" );
        WP_CLI::line( "   Status: {$pin->status}" . ( $pin->important ? ' ❗' : '' ) );
        WP_CLI::line( str_repeat( '─', 50 ) );

        foreach ( $rows as $c ) {
            $prefix = $c->type === 'event' ? '  [event]' : '  ' . $c->author_name;
            $read   = ( $c->type === 'comment' && ! $c->is_read ) ? ' [unread]' : '';
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
     * Add a comment to a pin.
     *
     * ## OPTIONS
     *
     * <pin_id>
     * : The ID of the pin
     *
     * <text>
     * : The text of the comment
     *
     * [--author=<name>]
     * : Author's name (default: AI Assistant)
     *
     * ## EXAMPLES
     *
     *     wp pinonion comment 42 "Fixed, please check"
     *     wp pinonion comment 42 "I investigated it" --author="Claude"
     *
     * @when after_wp_load
     */
    public function comment( $args, $assoc ) {
        global $wpdb;
        if ( count( $args ) < 2 ) {
            WP_CLI::error( 'Usage: wp pinonion comment <pin_id> <text>' );
        }

        $pin_id = (int) $args[0];
        $text   = sanitize_textarea_field( $args[1] );
        $author = sanitize_text_field( $assoc['author'] ?? 'AI Assistant' );

        $pin = $wpdb->get_row( $wpdb->prepare(
            "SELECT id FROM {$wpdb->prefix}pinonion_pins WHERE id = %d", $pin_id
        ) );
        if ( ! $pin ) {
            WP_CLI::error( "Pin #$pin_id not found" );
        }

        $now = current_time( 'mysql' );
        $wpdb->insert( $wpdb->prefix . 'pinonion_pin_comments', [
            'pin_id'       => $pin_id,
            'author_name'  => $author,
            'author_wp_id' => 0,
            'content'      => $text,
            'type'         => 'comment',
            'created_at'   => $now,
            'is_read'      => 0,
        ] );
        $wpdb->update( $wpdb->prefix . 'pinonion_pins', [ 'updated_at' => $now ], [ 'id' => $pin_id ] );

        WP_CLI::success( "Comment added to pin #{$pin_id}." );
    }

    /**
     * Modify pin status.
     *
     * ## OPTIONS
     *
     * <pin_id>
     * : The ID of the pin
     *
     * <status>
     * : New status: open, in_progress, done
     *
     * ## EXAMPLES
     *
     *     wp pinonion status 42 done
     *
     * @when after_wp_load
     */
    public function status( $args, $_assoc ) {
        unset( $_assoc );
        global $wpdb;
        if ( count( $args ) < 2 ) {
            WP_CLI::error( 'Usage: wp pinonion status <pin_id> <open|in_progress|done>' );
        }

        $pin_id    = (int) $args[0];
        $new_status = $args[1];

        if ( ! in_array( $new_status, [ 'open', 'in_progress', 'done' ], true ) ) {
            WP_CLI::error( 'Valid statuses: open, in_progress, done' );
        }

        $updated = $wpdb->update(
            $wpdb->prefix . 'pinonion_pins',
            [ 'status' => $new_status, 'updated_at' => current_time( 'mysql' ) ],
            [ 'id' => $pin_id ]
        );

        if ( ! $updated ) {
            WP_CLI::error( "Failed to update (does pin #{$pin_id} exist?)" );
        }
        WP_CLI::success( "Status of pin #{$pin_id}: {$new_status}" );
    }
}
