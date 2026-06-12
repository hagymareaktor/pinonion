<?php
// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery
// phpcs:disable WordPress.DB.DirectDatabaseQuery.NoCaching
// phpcs:disable WordPress.DB.DirectDatabaseQuery.SchemaChange
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
    exit;
}

global $wpdb;

$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}pinonion_pin_comments" );
$wpdb->query( "DROP TABLE IF EXISTS {$wpdb->prefix}pinonion_pins" );

delete_option( 'pinonion_settings' );
delete_option( 'pinonion_db_version' );
wp_clear_scheduled_hook( 'pinonion_auto_close_event' );
