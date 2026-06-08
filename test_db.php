<?php
require_once 'C:\Users\peti\Local Sites\purepin\app\public\wp-load.php';
global $wpdb;

$pt = $wpdb->prefix . 'purepin_pins';

$now = current_time( 'mysql' );
$res = $wpdb->insert( $pt, [
    'page_url'       => 'http://test.com',
    'page_title'     => 'Test',
    'x_pct'          => 10,
    'y_pct'          => 10,
    'status'         => 'open',
    'is_fixed'       => 0,
    'important'      => 0,
    'author_name'    => 'admin',
    'author_wp_id'   => 1,
    'author_ip'      => '127.0.0.1',
    'description'    => 'test desc',
    'viewport_width' => 1024,
    'css_selector'   => '',
    'scroll_context' => '[]',
    'created_at'     => $now,
    'updated_at'     => $now,
] );

if ($res === false) {
    echo "Insert failed. Error: " . $wpdb->last_error . "\n";
} else {
    echo "Insert success. ID: " . $wpdb->insert_id . "\n";
}
