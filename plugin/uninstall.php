<?php
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
    exit;
}

global $wpdb;

$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}purepin_pin_comments" );
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}purepin_pins" );

delete_option( 'purepin_review_settings' );
delete_option( 'purepin_review_db_version' );
wp_clear_scheduled_hook( 'purepin_rv_auto_close_event' );
