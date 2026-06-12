<?php
/**
 * Plugin Name: PinOnion Website Review
 * Plugin URI:  https://pinonion.com
 * Description: Lets your clients drop pins and leave feedback directly on any element of your live WordPress site for lightning-fast revisions.
 * Version:     0.9.1
 * Author:      onionreactor
 * License:     GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: pinonion
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'PINONION_VERSION', '0.9.0' );
define( 'PINONION_DIR',       plugin_dir_path( __FILE__ ) );
define( 'PINONION_URL',       plugin_dir_url( __FILE__ ) );
define( 'PINONION_MAIN_FILE', __FILE__ );



// ─── Activation: create tables ───────────────────────────────────────────

register_activation_hook( __FILE__, 'pinonion_activate' );

function pinonion_activate() {
    global $wpdb;
    $charset    = $wpdb->get_charset_collate();
    $pins_tbl   = $wpdb->prefix . 'pinonion_pins';
    $cmnts_tbl  = $wpdb->prefix . 'pinonion_pin_comments';

    $sql = "
    CREATE TABLE $pins_tbl (
        id           BIGINT(20)   NOT NULL AUTO_INCREMENT,
        page_url     VARCHAR(500) NOT NULL DEFAULT '',
        page_title   VARCHAR(255) NOT NULL DEFAULT '',
        x_pct        DECIMAL(7,4) NOT NULL DEFAULT 0,
        y_pct        DECIMAL(7,4) NOT NULL DEFAULT 0,
        status       VARCHAR(20)  NOT NULL DEFAULT 'open',
        important    TINYINT(1)   NOT NULL DEFAULT 0,
        is_fixed     TINYINT(1)   NOT NULL DEFAULT 0,
        author_name  VARCHAR(150) NOT NULL DEFAULT '',
        author_wp_id BIGINT(20)            DEFAULT 0,
        description  TEXT         NOT NULL,
        viewport_width SMALLINT   NOT NULL DEFAULT 0,
        css_selector VARCHAR(500) NOT NULL DEFAULT '',
        scroll_context TEXT       NOT NULL,
        created_at   DATETIME     NOT NULL,
        updated_at   DATETIME     NOT NULL,
        description_updated_at DATETIME     DEFAULT NULL,
        PRIMARY KEY (id),
        KEY page_url (page_url(191)),
        KEY status (status),
        KEY author_wp_id (author_wp_id)
    ) $charset;

    CREATE TABLE $cmnts_tbl (
        id           BIGINT(20)   NOT NULL AUTO_INCREMENT,
        pin_id       BIGINT(20)   NOT NULL,
        author_name  VARCHAR(150) NOT NULL DEFAULT '',
        author_wp_id BIGINT(20)            DEFAULT 0,
        content      TEXT         NOT NULL,
        type         VARCHAR(20)  NOT NULL DEFAULT 'comment',
        created_at   DATETIME     NOT NULL,
        is_read      TINYINT(1)   NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        KEY pin_id (pin_id),
        KEY is_read (is_read)
    ) $charset;
    ";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta( $sql );
}

// ─── DB migration: only if database version is lower ───────────────────

define( 'PINONION_DB_VERSION', '4' );

add_action( 'plugins_loaded', 'pinonion_maybe_upgrade' );

function pinonion_maybe_upgrade() {
    if ( get_option( 'pinonion_db_version' ) === PINONION_DB_VERSION ) {
        return;
    }

    global $wpdb;
    $pt = $wpdb->prefix . 'pinonion_pins';
    $ct = $wpdb->prefix . 'pinonion_pin_comments';

    // phpcs:disable WordPress.DB.PreparedSQL.NotPrepared
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$ct` LIKE 'type'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$ct` ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT 'comment' AFTER `is_read`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'important'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `important` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'is_fixed'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `is_fixed` TINYINT(1) NOT NULL DEFAULT 0 AFTER `important`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'description'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `description` TEXT NOT NULL AFTER `author_wp_id`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'viewport_width'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `viewport_width` SMALLINT NOT NULL DEFAULT 0 AFTER `description`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'css_selector'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `css_selector` VARCHAR(500) NOT NULL DEFAULT '' AFTER `viewport_width`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'scroll_context'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `scroll_context` TEXT NOT NULL DEFAULT '' AFTER `css_selector`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'description_updated_at'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `description_updated_at` DATETIME DEFAULT NULL AFTER `updated_at`" );
    }

    // V4 Indexes
    if ( get_option( 'pinonion_db_version' ) < '4' ) {
        if ( empty( $wpdb->get_results( "SHOW INDEX FROM `$pt` WHERE Key_name = 'status'" ) ) ) {
            $wpdb->query( "ALTER TABLE `$pt` ADD INDEX `status` (`status`)" );
        }
        if ( empty( $wpdb->get_results( "SHOW INDEX FROM `$pt` WHERE Key_name = 'author_wp_id'" ) ) ) {
            $wpdb->query( "ALTER TABLE `$pt` ADD INDEX `author_wp_id` (`author_wp_id`)" );
        }
        if ( empty( $wpdb->get_results( "SHOW INDEX FROM `$ct` WHERE Key_name = 'is_read'" ) ) ) {
            $wpdb->query( "ALTER TABLE `$ct` ADD INDEX `is_read` (`is_read`)" );
        }
    }
    // phpcs:enable

    update_option( 'pinonion_db_version', PINONION_DB_VERSION );
}

// ─── Load ────────────────────────────────────────────────────────────────

require_once PINONION_DIR . 'includes/Settings.php';
require_once PINONION_DIR . 'includes/Api.php';

if ( defined( 'WP_CLI' ) && WP_CLI ) {
    require_once PINONION_DIR . 'includes/Cli.php';
}

add_action( 'wp_enqueue_scripts', 'pinonion_enqueue' );

function pinonion_enqueue() {
    if ( ! is_user_logged_in() ) {
        return;
    }

    $is_dev    = pinonion_is_developer();
    $is_client = pinonion_is_client();

    if ( ! $is_dev && ! $is_client ) {
        return;
    }

    $can_manage = $is_dev;

    wp_enqueue_style(
        'pinonion',
        PINONION_URL . 'assets/css/review.css',
        [],
        PINONION_VERSION
    );
    wp_enqueue_script(
        'pinonion',
        PINONION_URL . 'assets/js/review.js',
        [],
        PINONION_VERSION,
        true
    );

    $user = wp_get_current_user();
    wp_localize_script( 'pinonion', 'purePinReview', [
        'apiUrl'             => rest_url( 'pinonion/v1/' ),
        'nonce'              => wp_create_nonce( 'wp_rest' ),
        'pageUrl'            => trailingslashit( esc_url( home_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '/' ) ) ) ) ),
        'pageTitle'          => wp_title( '–', false ) ?: get_bloginfo( 'name' ),
        'canManage'          => $can_manage,
        'user'               => $user->ID ? [
            'id'   => $user->ID,
            'name' => $user->display_name ?: $user->user_login,
        ] : null,
        'version'            => PINONION_VERSION,
        'clientCanClose'     => pinonion_opt( 'client_can_close' ) === '1',
        'fabPosition'        => pinonion_opt( 'fab_position' ) ?: 'right',
        'strings'            => [
            'newPin'          => __( 'New pin', 'pinonion' ),
            'namePlaceholder' => __( 'Your name…', 'pinonion' ),
            'descPlaceholder' => __( 'Description… what should we pay attention to?', 'pinonion' ),
            'urgent'          => __( 'Urgent task', 'pinonion' ),
            'pinPlaceLabel'   => __( 'Create a new review', 'pinonion' ),
            'filterUnread'    => __( 'Unread comments', 'pinonion' ),
            'filterNew'       => __( 'New pins', 'pinonion' ),
            'tabOpen'         => __( 'Open', 'pinonion' ),
            'tabInProgress'   => __( 'In progress', 'pinonion' ),
            'tabDone'         => __( 'Done', 'pinonion' ),
            'statusOpen'      => __( 'Open', 'pinonion' ),
            'statusInProgress'=> __( 'In Progress', 'pinonion' ),
            'statusDone'      => __( 'Done', 'pinonion' ),
        ],
    ] );
}

// ─── Plugin list: Settings link ──────────────────────────────────────────

add_filter( 'plugin_action_links_pinonion/pinonion.php', 'pinonion_action_links' );

function pinonion_action_links( $links ) {
    $settings_link = '<a href="' . admin_url( 'options-general.php?page=pinonion' ) . '">' . __( 'Settings', 'pinonion' ) . '</a>';
    array_unshift( $links, $settings_link );
    return $links;
}

// ─── Admin bar button ──────────────────────────────────────────────────────────

add_action( 'admin_bar_menu', 'pinonion_admin_bar', 100 );

function pinonion_admin_bar( WP_Admin_Bar $bar ) {
    if ( ! current_user_can( 'edit_posts' ) ) return;

    $current_url = esc_url( home_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '/' ) ) ) );
    if ( is_admin() ) {
        $current_url = home_url( '/' );
    }

    $bar->add_node( [
        'id'    => 'pinonion-toggle',
        'title' => 'PinOnion',
        'href'  => $current_url,
        'meta'  => [ 'target' => '_blank' ],
    ] );
}

