<?php
/**
 * PurePin Review – Settings (Settings API)
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ─── Defaults & Helpers ──────────────────────────────────────────────────────

function purepin_rv_defaults() {
    return [
        'fab_position'     => 'right',
        'developer_roles'  => [ 'administrator', 'editor' ],
        'client_roles'     => [ 'subscriber' ],
        'client_can_close' => '1',
        'uninstall_data'   => '0',
    ];
}

function purepin_rv_opt( $key ) {
    $opts = get_option( 'purepin_review_settings', [] );
    $defs = purepin_rv_defaults();
    return $opts[ $key ] ?? $defs[ $key ] ?? '';
}

function purepin_rv_is_developer( $user_id = null ) {
    if ( ! $user_id ) $user_id = get_current_user_id();
    if ( ! $user_id ) return false;
    
    if ( is_super_admin( $user_id ) ) return true;

    $user = get_userdata( $user_id );
    if ( ! $user ) return false;

    $dev_roles = purepin_rv_opt( 'developer_roles' );
    if ( ! is_array( $dev_roles ) ) $dev_roles = [];

    foreach ( $user->roles as $role ) {
        if ( in_array( $role, $dev_roles, true ) ) return true;
    }
    return false;
}

function purepin_rv_is_client( $user_id = null ) {
    if ( ! $user_id ) $user_id = get_current_user_id();
    if ( ! $user_id ) return false;

    $user = get_userdata( $user_id );
    if ( ! $user ) return false;

    $client_roles = purepin_rv_opt( 'client_roles' );
    if ( ! is_array( $client_roles ) ) $client_roles = [];

    foreach ( $user->roles as $role ) {
        if ( in_array( $role, $client_roles, true ) ) return true;
    }
    return false;
}

// ─── Admin menu ──────────────────────────────────────────────────────────────

add_action( 'admin_menu', 'purepin_rv_admin_menu' );

function purepin_rv_admin_menu() {
    add_options_page(
        __( 'PurePin Review Settings', 'purepin-review' ),
        'PurePin Review',
        'manage_options',
        'purepin-review',
        'purepin_rv_settings_page'
    );
}

// ─── Settings API registration ───────────────────────────────────────────────

add_action( 'admin_init', 'purepin_rv_register_settings' );

function purepin_rv_register_settings() {
    register_setting( 'purepin_review_group', 'purepin_review_settings',
        [ 'sanitize_callback' => 'purepin_rv_sanitize_settings' ] );
}

function purepin_rv_sanitize_settings( $input ) {
    $clean = [];

    $clean['developer_roles']  = isset( $input['developer_roles'] ) && is_array( $input['developer_roles'] ) ? array_map( 'sanitize_key', $input['developer_roles'] ) : [];
    $clean['client_roles']     = isset( $input['client_roles'] ) && is_array( $input['client_roles'] ) ? array_map( 'sanitize_key', $input['client_roles'] ) : [];
    $clean['client_can_close'] = isset( $input['client_can_close'] ) ? '1' : '0';
    
    $clean['fab_position']     = ( isset( $input['fab_position'] ) && $input['fab_position'] === 'left' ) ? 'left' : 'right';
    $clean['uninstall_data']   = isset( $input['uninstall_data'] ) ? '1' : '0';

    return $clean;
}

// ─── Field renderers ─────────────────────────────────────────────────────────

function purepin_rv_field_roles( $key, $desc ) {
    $val = purepin_rv_opt( $key );
    if ( ! is_array( $val ) ) $val = [];
    $roles = wp_roles()->get_names();
    
    echo '<div style="max-height: 180px; overflow-y: auto; padding: 12px; border: 1px solid #c3c4c7; background: #fff; width: 320px; border-radius: 4px; box-shadow: inset 0 1px 2px rgba(0,0,0,0.04);">';
    foreach ( $roles as $role_key => $role_name ) {
        $checked = in_array( $role_key, $val, true ) ? 'checked' : '';
        printf(
            '<label style="display:block;margin-bottom:8px"><input type="checkbox" name="purepin_review_settings[%s][]" value="%s" %s> %s</label>',
            esc_attr( $key ),
            esc_attr( $role_key ),
            $checked,
            esc_html( translate_user_role( $role_name ) )
        );
    }
    echo '</div>';
    echo '<p class="description" style="margin-top:8px">' . wp_kses_post( $desc ) . '</p>';
}

// ─── Settings page HTML ──────────────────────────────────────────────────────

function purepin_rv_settings_page() {
    if ( ! current_user_can( 'manage_options' ) ) return;

    // phpcs:ignore WordPress.Security.NonceVerification.Recommended
    $active = isset( $_GET['tab'] ) ? sanitize_key( $_GET['tab'] ) : 'permissions';

    $tabs = [
        'permissions' => [ 'label' => __( 'Roles & Permissions', 'purepin-review' ) ],
        'appearance'  => [ 'label' => __( 'Appearance', 'purepin-review' ) ],
        'advanced'    => [ 'label' => __( 'Advanced', 'purepin-review' ) ],
    ];
    ?>
    <div class="wrap" id="pp-settings-wrap">
        <h1 style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
            <span>PurePin Review <span style="font-weight:400;color:#999;font-size:18px"><?php esc_html_e( '— settings', 'purepin-review' ); ?></span></span>
        </h1>

        <style>
            #pp-settings-wrap { max-width: 780px; }
            .pp-tabs { display: flex; gap: 2px; border-bottom: 2px solid #e0e0e0; margin-bottom: 28px; flex-wrap: wrap; }
            .pp-tab-btn { padding: 9px 18px; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 500; color: #666; border-bottom: 2px solid transparent; margin-bottom: -2px; border-radius: 4px 4px 0 0; transition: all .15s; }
            .pp-tab-btn:hover { background: #f5f5f5; color: #333; }
            .pp-tab-btn.active { color: #2271b1; border-bottom-color: #2271b1; background: #f0f6fc; }
            .pp-tab-pane { display: none; }
            .pp-tab-pane.active { display: block; }
            .pp-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px 28px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .pp-card h3 { margin: 0 0 16px; font-size: 14px; font-weight: 600; color: #1d2327; border-bottom: 1px solid #f0f0f0; padding-bottom: 10px; }
            .pp-field { margin-bottom: 20px; }
            .pp-field:last-child { margin-bottom: 0; }
            .pp-field-label { font-weight: 600; font-size: 13px; color: #1d2327; margin-bottom: 6px; display: block; }
            .pp-field .description { color: #666; font-size: 12px; }
            .pp-radio-group { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
            .pp-radio-item { display: flex; gap: 10px; align-items: flex-start; padding: 10px 14px; border: 1px solid #e0e0e0; border-radius: 6px; cursor: pointer; transition: border-color .15s, background .15s; }
            .pp-radio-item:hover { border-color: #2271b1; background: #f8fbff; }
            .pp-radio-item input[type=radio] { margin-top: 3px; flex-shrink: 0; }
            .pp-radio-item.selected { border-color: #2271b1; background: #f0f6fc; }
            .pp-radio-item strong { display: block; font-size: 13px; margin-bottom: 2px; }
            .pp-radio-item .description { font-size: 12px; color: #666; }
            .pp-save { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
        </style>

        <nav class="pp-tabs">
            <?php foreach ( $tabs as $slug => $tab ) :
                $url = add_query_arg( 'tab', $slug );
                $cls = $active === $slug ? 'pp-tab-btn active' : 'pp-tab-btn';
            ?>
                <button class="<?php echo esc_attr( $cls ); ?>" onclick="location.href='<?php echo esc_url( $url ); ?>';return false">
                    <?php echo esc_html( $tab['label'] ); ?>
                </button>
            <?php endforeach; ?>
        </nav>

        <form method="post" action="options.php">
            <?php settings_fields( 'purepin_review_group' ); ?>

            <?php /* ── TAB: PERMISSIONS ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'permissions' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3><?php esc_html_e( 'Developer Roles', 'purepin-review' ); ?></h3>
                    <div class="pp-field">
                        <?php 
                        purepin_rv_field_roles( 'developer_roles', 
                            __( 'Users with these roles can view all pins across the site, change any pin\'s status, delete pins, and manage comments. (Typically Administrator, Editor, etc.)', 'purepin-review' )
                        ); 
                        ?>
                    </div>
                </div>
                <div class="pp-card">
                    <h3><?php esc_html_e( 'Client / Customer Roles', 'purepin-review' ); ?></h3>
                    <div class="pp-field">
                        <?php 
                        purepin_rv_field_roles( 'client_roles', 
                            __( 'Users with these roles can use the PurePin tool to drop pins and add comments, but they will <strong>only see their own pins</strong>. (Typically Subscriber, Customer, etc.)', 'purepin-review' )
                        ); 
                        ?>
                    </div>
                </div>
                <div class="pp-card">
                    <h3><?php esc_html_e( 'Client Capabilities', 'purepin-review' ); ?></h3>
                    <div class="pp-field">
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
                            <input type="checkbox" name="purepin_review_settings[client_can_close]" value="1"<?php checked( '1', purepin_rv_opt('client_can_close') ); ?> style="margin-top:3px">
                            <span>
                                <strong><?php esc_html_e( 'Allow clients to close/resolve their own pins', 'purepin-review' ); ?></strong><br>
                                <span class="description"><?php esc_html_e( 'If unchecked, only Developers can change pin status to Done.', 'purepin-review' ); ?></span>
                            </span>
                        </label>
                    </div>
                    <div class="pp-field" style="margin-top:10px; padding: 12px; background: #fffbe5; border-left: 4px solid #ffb900;">
                        <span class="description"><strong><?php esc_html_e( 'Note:', 'purepin-review' ); ?></strong> <?php esc_html_e( 'If a user does not have any of the Developer or Client roles selected above, the PurePin UI will simply not load for them.', 'purepin-review' ); ?></span>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( __( 'Save', 'purepin-review' ), 'primary', 'submit', false ); ?></div>
            </div>

            <?php /* ── TAB: APPEARANCE ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'appearance' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3><?php esc_html_e( 'FAB Button Position', 'purepin-review' ); ?></h3>
                    <div class="pp-field">
                        <div class="pp-radio-group">
                            <?php foreach ( [
                                'right' => [ 'label' => __( 'Right side', 'purepin-review' ), 'desc' => __( 'The feedback button appears in the bottom-right corner of the screen (default).', 'purepin-review' ) ],
                                'left'  => [ 'label' => __( 'Left side',  'purepin-review' ), 'desc' => __( 'The feedback button appears in the bottom-left corner of the screen.', 'purepin-review' ) ],
                            ] as $val => $opt ) :
                                $sel = purepin_rv_opt('fab_position') === $val ? ' selected' : '';
                            ?>
                                <label class="pp-radio-item<?php echo esc_attr( $sel ); ?>">
                                    <input type="radio" name="purepin_review_settings[fab_position]" value="<?php echo esc_attr($val); ?>"<?php checked( purepin_rv_opt('fab_position'), $val ); ?>>
                                    <span><strong><?php echo esc_html($opt['label']); ?></strong><span class="description"><?php echo esc_html($opt['desc']); ?></span></span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( __( 'Save', 'purepin-review' ), 'primary', 'submit', false ); ?></div>
            </div>

            <?php /* ── TAB: ADVANCED ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'advanced' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3><?php esc_html_e( 'Uninstall', 'purepin-review' ); ?></h3>
                    <div class="pp-field">
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
                            <input type="checkbox" name="purepin_review_settings[uninstall_data]" value="1"<?php checked( '1', purepin_rv_opt('uninstall_data') ); ?> style="margin-top:3px">
                            <span>
                                <strong style="color:#d63638"><?php esc_html_e( 'Delete data on uninstall', 'purepin-review' ); ?></strong><br>
                                <span class="description"><?php esc_html_e( 'If checked, all pins, comments, and settings will be permanently deleted when the plugin is uninstalled.', 'purepin-review' ); ?></span>
                            </span>
                        </label>
                    </div>
                </div>
                <div class="pp-card">
                    <h3><?php esc_html_e( 'Plugin Version', 'purepin-review' ); ?></h3>
                    <div class="pp-field">
                        <p style="margin:0;color:#666;font-size:13px">PurePin Review <strong><?php echo esc_html( PUREPIN_REVIEW_VERSION ); ?></strong></p>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( __( 'Save', 'purepin-review' ), 'primary', 'submit', false ); ?></div>
            </div>

        </form>
    </div>

    <script>
    document.querySelectorAll('.pp-radio-item input[type=radio]').forEach(function(r) {
        r.addEventListener('change', function() {
            var name = this.name;
            document.querySelectorAll('.pp-radio-item input[name="' + name + '"]').forEach(function(i) {
                i.closest('.pp-radio-item').classList.toggle('selected', i.checked);
            });
        });
    });
    </script>
    <?php
}

