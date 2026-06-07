<?php
/**
 * Plugin Name: PurePin Review
 * Description: Lets your clients drop pins and leave feedback directly on any element of your live WordPress site for lightning-fast revisions.
 * Version:     1.8.0
 * Author:      Peter Csontos
 */

if ( ! defined( 'ABSPATH' ) ) exit;

define( 'KGB_REVIEW_VERSION', '2.0.8' );
define( 'KGB_REVIEW_DIR',       plugin_dir_path( __FILE__ ) );
define( 'KGB_REVIEW_URL',       plugin_dir_url( __FILE__ ) );
define( 'KGB_REVIEW_MAIN_FILE', __FILE__ );

// ─── Aktiválás: táblák létrehozása ───────────────────────────────────────────

register_activation_hook( __FILE__, 'kgb_review_activate' );

function kgb_review_activate() {
    global $wpdb;
    $charset    = $wpdb->get_charset_collate();
    $pins_tbl   = $wpdb->prefix . 'kgb_pins';
    $cmnts_tbl  = $wpdb->prefix . 'kgb_pin_comments';

    $sql = "
    CREATE TABLE $pins_tbl (
        id           BIGINT(20)   NOT NULL AUTO_INCREMENT,
        page_url     VARCHAR(500) NOT NULL DEFAULT '',
        page_title   VARCHAR(255) NOT NULL DEFAULT '',
        x_pct        DECIMAL(7,4) NOT NULL DEFAULT 0,
        y_pct        DECIMAL(7,4) NOT NULL DEFAULT 0,
        status       VARCHAR(20)  NOT NULL DEFAULT 'open',
        author_name  VARCHAR(150) NOT NULL DEFAULT '',
        author_wp_id BIGINT(20)            DEFAULT 0,
        created_at   DATETIME     NOT NULL,
        updated_at   DATETIME     NOT NULL,
        PRIMARY KEY (id),
        KEY page_url (page_url(191))
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
        KEY pin_id (pin_id)
    ) $charset;
    ";

    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta( $sql );
}

// ─── DB migráció: type oszlop hozzáadása ha hiányzik ─────────────────────────

add_action( 'plugins_loaded', 'kgb_review_maybe_upgrade' );

function kgb_review_maybe_upgrade() {
    global $wpdb;
    $pt = $wpdb->prefix . 'kgb_pins';
    $ct = $wpdb->prefix . 'kgb_pin_comments';

    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$ct` LIKE 'type'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$ct` ADD COLUMN `type` VARCHAR(20) NOT NULL DEFAULT 'comment' AFTER `is_read`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'important'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `important` TINYINT(1) NOT NULL DEFAULT 0 AFTER `status`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'is_fixed'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `is_fixed` TINYINT(1) NOT NULL DEFAULT 0 AFTER `important`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'author_ip'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `author_ip` VARCHAR(45) NOT NULL DEFAULT '' AFTER `author_wp_id`" );
    }
    if ( empty( $wpdb->get_results( "SHOW COLUMNS FROM `$pt` LIKE 'description'" ) ) ) {
        $wpdb->query( "ALTER TABLE `$pt` ADD COLUMN `description` TEXT NOT NULL AFTER `author_ip`" );
    }
}

// ─── Betöltés ────────────────────────────────────────────────────────────────

require_once KGB_REVIEW_DIR . 'includes/Settings.php';
require_once KGB_REVIEW_DIR . 'includes/Api.php';

if ( defined( 'WP_CLI' ) && WP_CLI && kgb_rv_opt( 'cli_enabled' ) === '1' ) {
    require_once KGB_REVIEW_DIR . 'includes/Cli.php';
}

add_action( 'wp_enqueue_scripts', 'kgb_review_enqueue' );

function kgb_review_enqueue() {
    $is_editor      = current_user_can( 'edit_posts' );
    $has_review_get = isset( $_GET['review'] );
    $fully_public   = kgb_rv_fully_public();
    $public_link    = kgb_rv_public_link();

    // Szerkesztő mindig látja
    // Teljesen nyilvános mód: ?review=1 nélkül is
    // Publikus link mód: ?review=1 kell
    $can_see = $is_editor
        || ( $fully_public && $has_review_get )
        || ( $public_link  && $has_review_get );

    if ( ! $can_see ) return;

    wp_enqueue_style(
        'purepin-review',
        KGB_REVIEW_URL . 'assets/css/review.css',
        [],
        KGB_REVIEW_VERSION
    );
    wp_enqueue_script(
        'purepin-review',
        KGB_REVIEW_URL . 'assets/js/review.js',
        [],
        KGB_REVIEW_VERSION,
        true
    );

    $user = wp_get_current_user();
    wp_localize_script( 'purepin-review', 'purePinReview', [
        'apiUrl'             => rest_url( 'purepin/v1/' ),
        'nonce'              => wp_create_nonce( 'wp_rest' ),
        'pageUrl'            => trailingslashit( esc_url( home_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '/' ) ) ) ) ),
        'pageTitle'          => wp_title( '–', false ) ?: get_bloginfo( 'name' ),
        'canManage'          => $is_editor,
        'allowGuests'        => kgb_rv_allow_guests(),
        'allowGuestComment'  => kgb_rv_opt( 'allow_guest_comment' ) === '1',
        'tokenRequired'      => ! $is_editor && kgb_rv_token_enabled() && ! kgb_rv_check_session_cookie(),
        'displayMode'        => kgb_rv_opt( 'display_mode' ) ?: 'per_page',
        'pinLimit'           => (int) kgb_rv_opt( 'pin_limit' ),
        'user'               => $user->ID ? [
            'id'   => $user->ID,
            'name' => $user->display_name ?: $user->user_login,
        ] : null,
        'version'            => KGB_REVIEW_VERSION,
        'statusPerm'         => kgb_rv_opt( 'status_perm' ) ?: 'submitter',
        'fabPosition'        => kgb_rv_opt( 'fab_position' ) ?: 'right',
    ] );
}

// ─── Plugin lista: Beállítások link ──────────────────────────────────────────

add_filter( 'plugin_action_links_purepin-review/purepin-review.php', 'kgb_review_action_links' );

function kgb_review_action_links( $links ) {
    $settings_link = '<a href="' . admin_url( 'options-general.php?page=purepin-review' ) . '">Beállítások</a>';
    array_unshift( $links, $settings_link );
    return $links;
}

// ─── Admin bar gomb ──────────────────────────────────────────────────────────

add_action( 'admin_bar_menu', 'kgb_review_admin_bar', 100 );

function kgb_review_admin_bar( WP_Admin_Bar $bar ) {
    if ( ! current_user_can( 'edit_posts' ) ) return;

    $current_url = esc_url( home_url( sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ?? '/' ) ) ) );
    // Ha admin oldalon vagyunk, a főoldalra mutat; egyébként az aktuális oldalra
    if ( is_admin() ) {
        $current_url = home_url( '/' );
    }
    $review_url = add_query_arg( 'review', '1', $current_url );

    $bar->add_node( [
        'id'    => 'purepin-review-toggle',
        'title' => '📌 PurePin',
        'href'  => $review_url,
        'meta'  => [ 'target' => '_blank' ],
    ] );
}
