<?php
/**
 * Plugin Name: PurePin Review
 * Description: Lets your clients drop pins and leave feedback directly on any element of your live WordPress site for lightning-fast revisions.
 * Version:     0.9.0
 * Author:      Peter Csontos
 * License:     GPLv2 or later
 * License URI: https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain: purepin-review
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'PUREPIN_REVIEW_VERSION', '0.9.2' );
define( 'PUREPIN_REVIEW_DIR',       plugin_dir_path( __FILE__ ) );
define( 'PUREPIN_REVIEW_URL',       plugin_dir_url( __FILE__ ) );
define( 'PUREPIN_REVIEW_MAIN_FILE', __FILE__ );

add_action( 'init', function () {
    load_plugin_textdomain( 'purepin-review', false, dirname( plugin_basename( __FILE__ ) ) . '/languages' );
} );

// ─── Activation: create tables ───────────────────────────────────────────

register_activation_hook( __FILE__, 'purepin_review_activate' );

function purepin_review_activate() {
    global $wpdb;
    $charset    = $wpdb->get_charset_collate();
    $pins_tbl   = $wpdb->prefix . 'purepin_pins';
    $cmnts_tbl  = $wpdb->prefix . 'purepin_pin_comments';

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

define( 'PUREPIN_REVIEW_DB_VERSION', '4' );

add_action( 'plugins_loaded', 'purepin_review_maybe_upgrade' );

function purepin_review_maybe_upgrade() {
    if ( get_option( 'purepin_review_db_version' ) === PUREPIN_REVIEW_DB_VERSION ) {
        return;
    }

    global $wpdb;
    $pt = $wpdb->prefix . 'purepin_pins';
    $ct = $wpdb->prefix . 'purepin_pin_comments';

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
    if ( get_option( 'purepin_review_db_version' ) < '4' ) {
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

    update_option( 'purepin_review_db_version', PUREPIN_REVIEW_DB_VERSION );
}

// ─── Load ────────────────────────────────────────────────────────────────

require_once PUREPIN_REVIEW_DIR . 'includes/Settings.php';
require_once PUREPIN_REVIEW_DIR . 'includes/Api.php';

if ( defined( 'WP_CLI' ) && WP_CLI ) {
    require_once PUREPIN_REVIEW_DIR . 'includes/Cli.php';
}

add_action( 'wp_enqueue_scripts', 'purepin_review_enqueue' );

function purepin_review_enqueue() {
    if ( ! is_user_logged_in() ) {
        return;
    }

    $is_dev    = purepin_rv_is_developer();
    $is_client = purepin_rv_is_client();

    if ( ! $is_dev && ! $is_client ) {
        return;
    }

    $can_manage = $is_dev;

    wp_enqueue_style(
        'purepin-review',
        PUREPIN_REVIEW_URL . 'assets/css/review.css',
        [],
        PUREPIN_REVIEW_VERSION
    );
    wp_enqueue_script(
        'purepin-review',
        PUREPIN_REVIEW_URL . 'assets/js/review.js',
        [],
        PUREPIN_REVIEW_VERSION,
        true
    );

    $user = wp_get_current_user();
    wp_localize_script( 'purepin-review', 'purePinReview', [
        'apiUrl'             => rest_url( 'purepin/v1/' ),
        'nonce'              => wp_create_nonce( 'wp_rest' ),
        'pageUrl'            => trailingslashit( esc_url( home_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '/' ) ) ) ) ),
        'pageTitle'          => wp_title( '–', false ) ?: get_bloginfo( 'name' ),
        'canManage'          => $can_manage,
        'displayMode'        => purepin_rv_opt( 'display_mode' ) ?: 'per_page',
        'pinLimit'           => (int) purepin_rv_opt( 'pin_limit' ),
        'user'               => $user->ID ? [
            'id'   => $user->ID,
            'name' => $user->display_name ?: $user->user_login,
        ] : null,
        'version'            => PUREPIN_REVIEW_VERSION,
        'clientCanClose'     => purepin_rv_opt( 'client_can_close' ) === '1',
        'fabPosition'        => purepin_rv_opt( 'fab_position' ) ?: 'right',
        'strings'            => [
            'newPin'          => __( 'New pin', 'purepin-review' ),
            'namePlaceholder' => __( 'Your name…', 'purepin-review' ),
            'descPlaceholder' => __( 'Description… what should we pay attention to?', 'purepin-review' ),
            'urgent'          => __( 'Urgent task', 'purepin-review' ),
            'pinPlaceLabel'   => __( 'Create a new review', 'purepin-review' ),
            'filterUnread'    => __( 'Unread comments', 'purepin-review' ),
            'filterNew'       => __( 'New pins', 'purepin-review' ),
            'tabOpen'         => __( 'Open', 'purepin-review' ),
            'tabInProgress'   => __( 'In progress', 'purepin-review' ),
            'tabDone'         => __( 'Done', 'purepin-review' ),
            'statusOpen'      => __( 'Open', 'purepin-review' ),
            'statusInProgress'=> __( 'In Progress', 'purepin-review' ),
            'statusDone'      => __( 'Done', 'purepin-review' ),
        ],
    ] );
}

// ─── Plugin list: Settings link ──────────────────────────────────────────

add_filter( 'plugin_action_links_purepin-review/purepin-review.php', 'purepin_review_action_links' );

function purepin_review_action_links( $links ) {
    $settings_link = '<a href="' . admin_url( 'options-general.php?page=purepin-review' ) . '">' . __( 'Settings', 'purepin-review' ) . '</a>';
    array_unshift( $links, $settings_link );
    return $links;
}

// ─── Admin bar button ──────────────────────────────────────────────────────────

add_action( 'admin_bar_menu', 'purepin_review_admin_bar', 100 );

function purepin_review_admin_bar( WP_Admin_Bar $bar ) {
    if ( ! current_user_can( 'edit_posts' ) ) return;

    $current_url = esc_url( home_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '/' ) ) ) );
    if ( is_admin() ) {
        $current_url = home_url( '/' );
    }

    $bar->add_node( [
        'id'    => 'purepin-review-toggle',
        'title' => 'PurePin',
        'href'  => $current_url,
        'meta'  => [ 'target' => '_blank' ],
    ] );
}
