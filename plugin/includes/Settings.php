<?php
/**
 * PurePin Review – beállítások (Settings API)
 */

if ( ! defined( 'ABSPATH' ) ) exit;

// ─── Hozzáférési beállítások ─────────────────────────────────────────────────

function kgb_rv_visibility_options() {
    return [
        'admin_only' => [
            'label' => '🔒 Csak regisztrált felhasználók',
            'desc'  => 'A review felület csak a bejelentkezett WordPress felhasználóknak látszik. Ügyfelek semmit nem látnak, még megosztott linkkel sem.',
        ],
        'link' => [
            'label' => '🔗 Link birtokában lévők',
            'desc'  => 'Csak az férhet hozzá, akinek megvan a <code>?review=1</code> link. Küldöd az ügyfélnek — mások nem látják. <strong>Ez az ajánlott mód.</strong>',
        ],
        'public' => [
            'label' => '🌍 Bárki',
            'desc'  => 'Mindenki látja a review felületet, <code>?review=1</code> link nélkül is. Nyilvános feedback board-hoz vagy széles körű tesztelési fázishoz.',
        ],
    ];
}

function kgb_rv_submitter_options() {
    return [
        'registered' => [
            'label' => '👤 Csak regisztrált WP felhasználók',
            'desc'  => 'Pinelni és kommentelni csak WordPress fiókkal bejelentkezett felhasználók tudnak. Subscriber fiókot adsz az ügyfélnek — így visszanézheti a saját pinjeit is.',
        ],
        'guests' => [
            'label' => '👥 Vendégek is (névvel, fiók nélkül)',
            'desc'  => 'Fiók nélküli látogatók is küldhetnek pint — névüket megadva (egyirányú, visszanézni nem tudják). Kommentelni szintén névvel lehet.',
        ],
    ];
}

// ─── Defaults ────────────────────────────────────────────────────────────────

function kgb_rv_defaults() {
    return [
        'review_visibility'  => 'link',
        'allowed_submitters' => 'guests',
        'display_mode'       => 'per_page',
        'token_enabled'      => '0',
        'token_value'        => '',
        'allow_guest_comment'=> '1',
        'notify_pin'         => '0',
        'notify_comment'     => '0',
        'notify_email'       => get_option( 'admin_email', '' ),
        'pin_limit'          => '0',
        'auto_close_days'    => '0',
        'cli_enabled'        => '0',
        'status_perm'        => 'submitter',
        'fab_position'       => 'right',
    ];
}

function kgb_rv_opt( $key ) {
    $opts = get_option( 'kgb_review_settings', [] );
    $defs = kgb_rv_defaults();

    // ── Migráció: régi access_mode → új két mező ────────────────────────────
    if ( $key === 'review_visibility' && ! isset( $opts['review_visibility'] ) ) {
        $old = $opts['access_mode'] ?? ( ( $opts['public_link'] ?? '' ) !== '1' ? 'admin_only' : 'link_anon' );
        if ( $old === 'admin_only' )                            return 'admin_only';
        if ( in_array( $old, [ 'fully_public', 'public_read' ], true ) ) return 'public';
        return 'link'; // link_anon, link_logged
    }
    if ( $key === 'allowed_submitters' && ! isset( $opts['allowed_submitters'] ) ) {
        $old = $opts['access_mode'] ?? 'link_anon';
        return in_array( $old, [ 'link_anon', 'fully_public' ], true ) ? 'guests' : 'registered';
    }

    return $opts[ $key ] ?? $defs[ $key ] ?? '';
}

// Segédfüggvények
function kgb_rv_public_link()    { return kgb_rv_opt('review_visibility') !== 'admin_only'; }
function kgb_rv_allow_guests()   {
    if ( kgb_rv_opt('review_visibility') === 'admin_only' ) return false;
    return kgb_rv_opt('allowed_submitters') === 'guests';
}
function kgb_rv_fully_public()   { return kgb_rv_opt('review_visibility') === 'public'; }
function kgb_rv_token_enabled()  { return kgb_rv_opt('token_enabled') === '1' && kgb_rv_opt('token_value') !== ''; }

function kgb_rv_check_session_cookie() {
    if ( ! kgb_rv_token_enabled() ) return true;
    $expected = wp_hash( kgb_rv_opt('token_value') . COOKIEHASH );
    return isset( $_COOKIE['kgb_rv_access'] ) && hash_equals( $expected, $_COOKIE['kgb_rv_access'] );
}

// ─── Admin menü ──────────────────────────────────────────────────────────────

add_action( 'admin_menu', 'kgb_rv_admin_menu' );

function kgb_rv_admin_menu() {
    add_options_page(
        'PurePin Review beállítások',
        'PurePin Review',
        'manage_options',
        'purepin-review',
        'kgb_rv_settings_page'
    );
}

// ─── Settings API regisztráció ────────────────────────────────────────────────

add_action( 'admin_init', 'kgb_rv_register_settings' );

function kgb_rv_register_settings() {
    register_setting( 'purepin_review_group', 'kgb_review_settings',
        [ 'sanitize_callback' => 'kgb_rv_sanitize_settings' ] );

    // ── Megjelenítési mód ──
    add_settings_section( 'kgb_rv_display', 'Megjelenítési mód', '__return_false', 'purepin-review' );
    add_settings_field( 'display_mode', 'Pin lista hatóköre',
        'kgb_rv_field_display_mode', 'purepin-review', 'kgb_rv_display' );

    // ── Hozzáférés ──
    add_settings_section( 'kgb_rv_access', 'Hozzáférés', '__return_false', 'purepin-review' );
    add_settings_field( 'review_visibility', 'Ki látja?',
        '__return_false', 'purepin-review', 'kgb_rv_access' );
    add_settings_field( 'allowed_submitters', 'Ki írhat?',
        '__return_false', 'purepin-review', 'kgb_rv_access' );

    // ── Értesítés ──
    add_settings_section( 'kgb_rv_notify', 'Email értesítés', '__return_false', 'purepin-review' );
    add_settings_field( 'notify', 'Értesítés küldése',
        'kgb_rv_field_checkbox', 'purepin-review', 'kgb_rv_notify',
        [ 'key' => 'notify', 'desc' => 'Új pin vagy komment esetén emailt küld.' ] );
    add_settings_field( 'notify_email', 'Értesítési email cím',
        'kgb_rv_field_text', 'purepin-review', 'kgb_rv_notify',
        [ 'key' => 'notify_email', 'type' => 'email', 'desc' => 'Ha üres, az admin email-t használja.' ] );

    // ── Státusz jogosultság ──
    add_settings_section( 'kgb_rv_status_perm', 'Státusz módosítás jogosultsága', '__return_false', 'purepin-review' );
    add_settings_field( 'status_perm', 'Ki módosíthatja a pin státuszát?',
        'kgb_rv_field_status_perm', 'purepin-review', 'kgb_rv_status_perm' );

    // ── Megjelenés ──
    add_settings_section( 'kgb_rv_appearance', 'Megjelenés', '__return_false', 'purepin-review' );
    add_settings_field( 'fab_position', 'FAB gomb pozíciója',
        'kgb_rv_field_fab_position', 'purepin-review', 'kgb_rv_appearance' );

    // ── Fejlesztői eszközök ──
    add_settings_section( 'kgb_rv_dev', 'Fejlesztői eszközök', '__return_false', 'purepin-review' );
    add_settings_field( 'cli_enabled', 'WP-CLI parancsok',
        'kgb_rv_field_checkbox', 'purepin-review', 'kgb_rv_dev',
        [ 'key' => 'cli_enabled', 'desc' => 'Engedélyezi a wp purepin CLI parancsokat (list, summary, comment). AI eszközökhöz, automatizáláshoz.' ] );

    // ── Korlátok ──
    add_settings_section( 'kgb_rv_limits', 'Korlátok', '__return_false', 'purepin-review' );
    add_settings_field( 'pin_limit', 'Pin limit oldalanként',
        'kgb_rv_field_number', 'purepin-review', 'kgb_rv_limits',
        [ 'key' => 'pin_limit', 'desc' => '0 = korlátlan. Vendégenként maximum ennyi pint lehet elhelyezni oldalanként.' ] );
    add_settings_field( 'auto_close_days', 'Auto-lezárás (nap)',
        'kgb_rv_field_number', 'purepin-review', 'kgb_rv_limits',
        [ 'key' => 'auto_close_days', 'desc' => '0 = kikapcsolt. Ennyi nap után a nyitott pinek automatikusan "Lezárva" státuszba kerülnek.' ] );
}

function kgb_rv_sanitize_settings( $input ) {
    $clean = [];
    $defs  = kgb_rv_defaults();

    $clean['display_mode']         = in_array( $input['display_mode'] ?? '', [ 'per_page', 'global' ], true )
                                     ? $input['display_mode'] : 'per_page';
    $clean['review_visibility']    = in_array( $input['review_visibility'] ?? '', [ 'admin_only', 'link', 'public' ], true )
                                     ? $input['review_visibility'] : 'link';
    $clean['allowed_submitters']   = in_array( $input['allowed_submitters'] ?? '', [ 'registered', 'guests' ], true )
                                     ? $input['allowed_submitters'] : 'guests';
    $clean['token_enabled']        = isset( $input['token_enabled'] ) ? '1' : '0';
    $clean['token_value']         = sanitize_text_field( $input['token_value'] ?? '' );
    $clean['allow_guest_comment'] = isset( $input['allow_guest_comment'] ) ? '1' : '0';
    $clean['notify_pin']          = isset( $input['notify_pin'] ) ? '1' : '0';
    $clean['notify_comment']      = isset( $input['notify_comment'] ) ? '1' : '0';
    $clean['notify_email']        = sanitize_email( $input['notify_email'] ?? '' );
    $clean['pin_limit']           = max( 0, (int) ( $input['pin_limit'] ?? 0 ) );
    $clean['auto_close_days']     = max( 0, (int) ( $input['auto_close_days'] ?? 0 ) );
    $clean['cli_enabled']         = isset( $input['cli_enabled'] ) ? '1' : '0';
    $clean['status_perm']         = in_array( $input['status_perm'] ?? '', [ 'admin_only', 'submitter' ], true )
                                    ? $input['status_perm'] : 'submitter';
    $clean['fab_position']        = in_array( $input['fab_position'] ?? '', [ 'right', 'left' ], true )
                                    ? $input['fab_position'] : 'right';

    return $clean;
}

// ─── Mezők ───────────────────────────────────────────────────────────────────

function kgb_rv_field_display_mode() {
    $current = kgb_rv_opt( 'display_mode' );
    $modes   = [
        'per_page' => [
            'label' => '📄 Oldalanként',
            'desc'  => 'A panel csak az aktuális oldal pinjeit mutatja. Minden oldal külön review felületként működik.',
        ],
        'global' => [
            'label' => '🌐 Globális — minden oldal',
            'desc'  => 'A panel az összes oldal pinjeit mutatja egyszerre. Szűrhető oldalak szerint. Más oldalon lévő pinre kattintva átnavigál.',
        ],
    ];
    echo '<fieldset style="margin-top:4px">';
    foreach ( $modes as $value => $mode ) {
        $checked = checked( $current, $value, false );
        printf(
            '<label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:12px;cursor:pointer">
              <input type="radio" name="kgb_review_settings[display_mode]" value="%s"%s style="margin-top:3px;flex-shrink:0">
              <span>
                <strong>%s</strong><br>
                <span class="description">%s</span>
              </span>
            </label>',
            esc_attr( $value ),
            $checked,
            esc_html( $mode['label'] ),
            esc_html( $mode['desc'] )
        );
    }
    echo '</fieldset>';
}


function kgb_rv_field_token() {
    $enabled = kgb_rv_opt('token_enabled') === '1';
    $value   = kgb_rv_opt('token_value');
    $dis     = $enabled ? '' : ' disabled';
    ?>
    <div style="padding:14px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa">

        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin-bottom:14px">
            <input type="checkbox"
                   name="kgb_review_settings[token_enabled]"
                   value="1"
                   id="pp-token-enabled"
                   <?php checked( $enabled ); ?>
                   style="margin-top:3px">
            <span>
                <strong>PIN-kód védelem bekapcsolása</strong><br>
                <span class="description">Ha aktív, a <code>?review=1</code> link megnyitásakor a látogató kódot kell megadjon. Az admin mindig hozzáfér kód nélkül.</span>
            </span>
        </label>

        <div style="display:flex;align-items:center;gap:10px;padding-left:28px" id="pp-token-fields">
            <div>
                <label style="display:block;font-size:12px;font-weight:600;color:#555;margin-bottom:4px">Hozzáférési kód</label>
                <input type="text"
                       name="kgb_review_settings[token_value]"
                       id="pp-token-value"
                       value="<?php echo esc_attr( $value ); ?>"
                       placeholder="pl. 4821"
                       maxlength="20"
                       style="width:130px;font-size:20px;letter-spacing:5px;font-family:monospace;text-transform:uppercase"
                       autocomplete="off"
                       <?php echo $dis; ?>>
            </div>
            <button type="button"
                    id="pp-token-generate"
                    class="button"
                    style="margin-top:18px"
                    <?php echo $dis; ?>>Generálás</button>
        </div>

    </div>

    <script>
    (function() {
        var cb  = document.getElementById('pp-token-enabled');
        var inp = document.getElementById('pp-token-value');
        var btn = document.getElementById('pp-token-generate');

        function sync() {
            inp.disabled = !cb.checked;
            btn.disabled = !cb.checked;
            document.getElementById('pp-token-fields').style.opacity = cb.checked ? '1' : '.45';
        }
        cb.addEventListener('change', sync);
        sync();

        btn.addEventListener('click', function() {
            var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
            var r = '';
            for (var i = 0; i < 6; i++) r += c[Math.floor(Math.random() * c.length)];
            inp.value = r;
        });
    })();
    </script>
    <?php
}

function kgb_rv_field_checkbox( $args ) {
    $val = kgb_rv_opt( $args['key'] );
    printf(
        '<label><input type="checkbox" name="kgb_review_settings[%s]" value="1"%s> <span class="description">%s</span></label>',
        esc_attr( $args['key'] ),
        checked( '1', $val, false ),
        esc_html( $args['desc'] )
    );
}

function kgb_rv_field_text( $args ) {
    $val = kgb_rv_opt( $args['key'] );
    printf(
        '<input type="%s" name="kgb_review_settings[%s]" value="%s" class="regular-text"><p class="description">%s</p>',
        esc_attr( $args['type'] ?? 'text' ),
        esc_attr( $args['key'] ),
        esc_attr( $val ),
        esc_html( $args['desc'] )
    );
}

function kgb_rv_field_number( $args ) {
    $val = kgb_rv_opt( $args['key'] );
    printf(
        '<input type="number" min="0" name="kgb_review_settings[%s]" value="%s" style="width:80px"> <span class="description">%s</span>',
        esc_attr( $args['key'] ),
        esc_attr( $val ),
        esc_html( $args['desc'] )
    );
}

function kgb_rv_field_status_perm() {
    $current = kgb_rv_opt( 'status_perm' );
    $options = [
        'admin_only' => [
            'label' => '🔒 Csak az adminisztrátorok / fejlesztők',
            'desc'  => 'Szigorú módszer: csak a WordPress szerkesztő jogkörrel rendelkező felhasználók módosíthatják a státuszt (Nyitott → Folyamatban → Kész).',
        ],
        'submitter'  => [
            'label' => '🤝 Adminok + a pin eredeti beküldője',
            'desc'  => 'Rugalmas, ügyfélközpontú módszer: a beküldő a <strong>saját</strong> pinjét visszanyithatja (ha a hiba még fennáll) vagy lezárhatja (ha rendben van). A "Folyamatban" állapotot csak admin állíthatja.',
        ],
    ];
    foreach ( $options as $val => $opt ) {
        printf(
            '<label style="display:block;margin-bottom:10px"><input type="radio" name="kgb_review_settings[status_perm]" value="%s"%s> <strong>%s</strong><p class="description" style="margin-left:24px;margin-top:4px">%s</p></label>',
            esc_attr( $val ),
            checked( $current, $val, false ),
            esc_html( $opt['label'] ),
            wp_kses_post( $opt['desc'] )
        );
    }
}

function kgb_rv_field_fab_position() {
    $current = kgb_rv_opt( 'fab_position' );
    $options = [
        'right' => [ 'label' => '➡ Jobb oldal', 'desc' => 'A FAB gomb a képernyő jobb alsó sarkában jelenik meg (alapértelmezett).' ],
        'left'  => [ 'label' => '⬅ Bal oldal',  'desc' => 'A FAB gomb a képernyő bal alsó sarkában jelenik meg.' ],
    ];
    echo '<fieldset style="margin-top:4px">';
    foreach ( $options as $val => $opt ) {
        printf(
            '<label style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;cursor:pointer">
              <input type="radio" name="kgb_review_settings[fab_position]" value="%s"%s style="margin-top:3px;flex-shrink:0">
              <span><strong>%s</strong><br><span class="description">%s</span></span>
            </label>',
            esc_attr( $val ),
            checked( $current, $val, false ),
            esc_html( $opt['label'] ),
            esc_html( $opt['desc'] )
        );
    }
    echo '</fieldset>';
}

// ─── Beállítások oldal HTML ───────────────────────────────────────────────────

function kgb_rv_settings_page() {
    if ( ! current_user_can( 'manage_options' ) ) return;

    $active = isset( $_GET['tab'] ) ? sanitize_key( $_GET['tab'] ) : 'megjelenes';

    $tabs = [
        'megjelenes'    => [ 'label' => '🎨 Megjelenés',      'icon' => '🎨' ],
        'hozzaferes'    => [ 'label' => '🔐 Hozzáférés',      'icon' => '🔐' ],
        'jogosultsag'   => [ 'label' => '👥 Jogosultságok',   'icon' => '👥' ],
        'ertesites'     => [ 'label' => '🔔 Értesítések',     'icon' => '🔔' ],
        'korlatok'      => [ 'label' => '⚙️ Korlátok',        'icon' => '⚙️' ],
        'fejleszto'     => [ 'label' => '🛠 Fejlesztő',       'icon' => '🛠' ],
    ];
    ?>
    <div class="wrap" id="pp-settings-wrap">
        <h1 style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
            <span style="font-size:28px">📌</span>
            <span>PurePin Review <span style="font-weight:400;color:#999;font-size:18px">— beállítások</span></span>
        </h1>

        <style>
            #pp-settings-wrap { max-width: 780px; }
            .pp-tabs { display: flex; gap: 2px; border-bottom: 2px solid #e0e0e0; margin-bottom: 28px; flex-wrap: wrap; }
            .pp-tab-btn { padding: 9px 18px; border: none; background: none; cursor: pointer; font-size: 13px; font-weight: 500; color: #666; border-bottom: 2px solid transparent; margin-bottom: -2px; border-radius: 4px 4px 0 0; transition: all .15s; }
            .pp-tab-btn:hover { background: #f5f5f5; color: #333; }
            .pp-tab-btn.active { color: #2271b1; border-bottom-color: #2271b1; background: #f0f6fc; }
            .pp-tab-pane { display: none; }
            .pp-tab-pane.active { display: block; }
            .pp-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 24px 28px; margin-bottom: 20px; }
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
                <button class="<?php echo $cls; ?>" onclick="location.href='<?php echo esc_url( $url ); ?>';return false">
                    <?php echo esc_html( $tab['label'] ); ?>
                </button>
            <?php endforeach; ?>
        </nav>

        <form method="post" action="options.php">
            <?php settings_fields( 'purepin_review_group' ); ?>

            <?php /* ── TAB: MEGJELENÉS ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'megjelenes' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3>FAB gomb pozíciója</h3>
                    <div class="pp-field">
                        <div class="pp-radio-group">
                            <?php foreach ( [ 'right' => [ 'label' => '➡ Jobb oldal', 'desc' => 'A visszajelző gomb a képernyő jobb alsó sarkában jelenik meg (alapértelmezett).' ], 'left' => [ 'label' => '⬅ Bal oldal', 'desc' => 'A visszajelző gomb a képernyő bal alsó sarkában jelenik meg.' ] ] as $val => $opt ) :
                                $sel = kgb_rv_opt('fab_position') === $val ? ' selected' : '';
                            ?>
                                <label class="pp-radio-item<?php echo $sel; ?>">
                                    <input type="radio" name="kgb_review_settings[fab_position]" value="<?php echo esc_attr($val); ?>"<?php checked( kgb_rv_opt('fab_position'), $val ); ?>>
                                    <span><strong><?php echo esc_html($opt['label']); ?></strong><span class="description"><?php echo esc_html($opt['desc']); ?></span></span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
                <div class="pp-card">
                    <h3>Pin lista hatóköre</h3>
                    <div class="pp-field">
                        <div class="pp-radio-group">
                            <?php foreach ( [ 'per_page' => [ 'label' => '📄 Oldalanként', 'desc' => 'A panel csak az aktuális oldal pinjeit mutatja. Minden oldal külön review felületként működik.' ], 'global' => [ 'label' => '🌐 Globális — minden oldal', 'desc' => 'A panel az összes oldal pinjeit mutatja egyszerre. Szűrhető oldalak szerint.' ] ] as $val => $opt ) :
                                $sel = kgb_rv_opt('display_mode') === $val ? ' selected' : '';
                            ?>
                                <label class="pp-radio-item<?php echo $sel; ?>">
                                    <input type="radio" name="kgb_review_settings[display_mode]" value="<?php echo esc_attr($val); ?>"<?php checked( kgb_rv_opt('display_mode'), $val ); ?>>
                                    <span><strong><?php echo esc_html($opt['label']); ?></strong><span class="description"><?php echo esc_html($opt['desc']); ?></span></span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( 'Mentés', 'primary', 'submit', false ); ?></div>
            </div>

            <?php /* ── TAB: HOZZÁFÉRÉS ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'hozzaferes' ? 'active' : ''; ?>">

                <?php
                $cur_vis  = kgb_rv_opt('review_visibility');
                $cur_sub  = kgb_rv_opt('allowed_submitters');
                ?>

                <div class="pp-card">
                    <h3>1. lépés — Ki <em>látja</em> a review felületet?</h3>
                    <div class="pp-field">
                        <div class="pp-radio-group">
                            <?php foreach ( kgb_rv_visibility_options() as $val => $opt ) : ?>
                                <label class="pp-radio-item<?php echo $cur_vis === $val ? ' selected' : ''; ?>">
                                    <input type="radio"
                                           name="kgb_review_settings[review_visibility]"
                                           value="<?php echo esc_attr($val); ?>"
                                           id="pp-vis-<?php echo esc_attr($val); ?>"
                                           <?php checked( $cur_vis, $val ); ?>>
                                    <span>
                                        <strong><?php echo esc_html($opt['label']); ?></strong>
                                        <span class="description"><?php echo wp_kses_post($opt['desc']); ?></span>
                                    </span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                        <p class="description" style="margin-top:10px">
                            💡 Megosztható review link: <code><?php echo esc_html( home_url('/?review=1') ); ?></code>
                        </p>
                    </div>
                </div>

                <div class="pp-card" id="pp-submitters-card" style="<?php echo $cur_vis === 'admin_only' ? 'opacity:.45;pointer-events:none' : ''; ?>">
                    <h3>2. lépés — Ki <em>írhat</em> pineket?</h3>
                    <div class="pp-field">
                        <div class="pp-radio-group">
                            <?php foreach ( kgb_rv_submitter_options() as $val => $opt ) : ?>
                                <label class="pp-radio-item<?php echo $cur_sub === $val ? ' selected' : ''; ?>">
                                    <input type="radio"
                                           name="kgb_review_settings[allowed_submitters]"
                                           value="<?php echo esc_attr($val); ?>"
                                           <?php checked( $cur_sub, $val ); ?>>
                                    <span>
                                        <strong><?php echo esc_html($opt['label']); ?></strong>
                                        <span class="description"><?php echo esc_html($opt['desc']); ?></span>
                                    </span>
                                </label>
                            <?php endforeach; ?>
                        </div>
                    </div>
                    <div class="pp-field" id="pp-guest-comment-wrap" style="<?php echo $cur_sub !== 'guests' ? 'display:none' : ''; ?>">
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px 14px;border:1px solid #e0e0e0;border-radius:6px;background:#fafafa">
                            <input type="checkbox" name="kgb_review_settings[allow_guest_comment]" value="1"<?php checked( '1', kgb_rv_opt('allow_guest_comment') ); ?> style="margin-top:3px">
                            <span>
                                <strong>Névtelen kommentálás engedélyezése</strong><br>
                                <span class="description">A vendég beküldő kommentelhet meglévő pinekre is bejelentkezés nélkül.</span>
                            </span>
                        </label>
                    </div>
                </div>

                <div class="pp-card">
                    <h3>3. lépés — PIN-kód védelem <span style="font-weight:400;color:#999;font-size:12px">(opcionális)</span></h3>
                    <div class="pp-field">
                        <?php kgb_rv_field_token(); ?>
                    </div>
                </div>

                <div class="pp-save"><?php submit_button( 'Mentés', 'primary', 'submit', false ); ?></div>

                <script>
                (function() {
                    var visInputs   = document.querySelectorAll('input[name="kgb_review_settings[review_visibility]"]');
                    var subInputs   = document.querySelectorAll('input[name="kgb_review_settings[allowed_submitters]"]');
                    var subCard     = document.getElementById('pp-submitters-card');
                    var guestWrap   = document.getElementById('pp-guest-comment-wrap');

                    function syncVis() {
                        var val = document.querySelector('input[name="kgb_review_settings[review_visibility]"]:checked');
                        if (!val) return;
                        var isAdmin = val.value === 'admin_only';
                        subCard.style.opacity          = isAdmin ? '.45' : '1';
                        subCard.style.pointerEvents    = isAdmin ? 'none' : '';
                    }
                    function syncSub() {
                        var val = document.querySelector('input[name="kgb_review_settings[allowed_submitters]"]:checked');
                        if (!val) return;
                        guestWrap.style.display = val.value === 'guests' ? '' : 'none';
                    }

                    visInputs.forEach(function(r) { r.addEventListener('change', syncVis); });
                    subInputs.forEach(function(r) { r.addEventListener('change', syncSub); });
                })();
                </script>
            </div>

            <?php /* ── TAB: JOGOSULTSÁGOK ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'jogosultsag' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3>Ki módosíthatja a pin státuszát?</h3>
                    <div class="pp-field">
                        <?php foreach ( [ 'admin_only' => [ 'label' => '🔒 Csak az adminisztrátorok / fejlesztők', 'desc' => 'Szigorú: csak WordPress szerkesztő jogkörű felhasználók módosíthatják a státuszt.' ], 'submitter' => [ 'label' => '🤝 Adminok + a pin eredeti beküldője', 'desc' => 'Rugalmas: a beküldő a saját pinjét visszanyithatja vagy lezárhatja. A "Folyamatban" állapotot csak admin állíthatja.' ] ] as $val => $opt ) : ?>
                            <label class="pp-radio-item<?php echo kgb_rv_opt('status_perm') === $val ? ' selected' : ''; ?>" style="margin-bottom:10px">
                                <input type="radio" name="kgb_review_settings[status_perm]" value="<?php echo esc_attr($val); ?>"<?php checked( kgb_rv_opt('status_perm'), $val ); ?>>
                                <span><strong><?php echo esc_html($opt['label']); ?></strong><span class="description" style="display:block;margin-top:3px"><?php echo wp_kses_post($opt['desc']); ?></span></span>
                            </label>
                        <?php endforeach; ?>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( 'Mentés', 'primary', 'submit', false ); ?></div>
            </div>

            <?php /* ── TAB: ÉRTESÍTÉSEK ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'ertesites' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3>Mikor küldjön értesítést?</h3>
                    <div class="pp-field">
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px 14px;border:1px solid #e0e0e0;border-radius:6px;margin-bottom:8px">
                            <input type="checkbox" name="kgb_review_settings[notify_pin]" value="1"<?php checked( '1', kgb_rv_opt('notify_pin') ); ?> style="margin-top:3px">
                            <span>
                                <strong>📌 Új pin beküldésekor</strong><br>
                                <span class="description">Amikor valaki új visszajelzést helyez el az oldalon.</span>
                            </span>
                        </label>
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px 14px;border:1px solid #e0e0e0;border-radius:6px">
                            <input type="checkbox" name="kgb_review_settings[notify_comment]" value="1"<?php checked( '1', kgb_rv_opt('notify_comment') ); ?> style="margin-top:3px">
                            <span>
                                <strong>💬 Új komment érkezésekor</strong><br>
                                <span class="description">Amikor valaki hozzászól egy meglévő pinhez.</span>
                            </span>
                        </label>
                    </div>
                    <div class="pp-field">
                        <label class="pp-field-label">Értesítési email cím</label>
                        <input type="email" name="kgb_review_settings[notify_email]" value="<?php echo esc_attr( kgb_rv_opt('notify_email') ); ?>" class="regular-text">
                        <p class="description">Ha üres, az admin email-t használja: <code><?php echo esc_html( get_option('admin_email') ); ?></code></p>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( 'Mentés', 'primary', 'submit', false ); ?></div>
            </div>

            <?php /* ── TAB: KORLÁTOK ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'korlatok' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3>Pin korlátok</h3>
                    <div class="pp-field">
                        <label class="pp-field-label">Pin limit oldalanként</label>
                        <input type="number" min="0" name="kgb_review_settings[pin_limit]" value="<?php echo esc_attr( kgb_rv_opt('pin_limit') ); ?>" style="width:80px">
                        <p class="description">0 = korlátlan. Vendégenként maximum ennyi pint lehet elhelyezni oldalanként.</p>
                    </div>
                    <div class="pp-field">
                        <label class="pp-field-label">Auto-lezárás (nap)</label>
                        <input type="number" min="0" name="kgb_review_settings[auto_close_days]" value="<?php echo esc_attr( kgb_rv_opt('auto_close_days') ); ?>" style="width:80px">
                        <p class="description">0 = kikapcsolt. Ennyi nap után a nyitott pinek automatikusan „Kész" státuszba kerülnek.</p>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( 'Mentés', 'primary', 'submit', false ); ?></div>
            </div>

            <?php /* ── TAB: FEJLESZTŐ ── */ ?>
            <div class="pp-tab-pane <?php echo $active === 'fejleszto' ? 'active' : ''; ?>">
                <div class="pp-card">
                    <h3>WP-CLI integráció</h3>
                    <div class="pp-field">
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer">
                            <input type="checkbox" name="kgb_review_settings[cli_enabled]" value="1"<?php checked( '1', kgb_rv_opt('cli_enabled') ); ?> style="margin-top:3px">
                            <span><strong>WP-CLI parancsok engedélyezése</strong><br><span class="description">Engedélyezi a <code>wp purepin</code> CLI parancsokat (list, summary, comment). AI eszközökhöz, automatizáláshoz.</span></span>
                        </label>
                    </div>
                </div>
                <div class="pp-card">
                    <h3>Plugin verzió</h3>
                    <div class="pp-field">
                        <p style="margin:0;color:#666;font-size:13px">PurePin Review <strong><?php echo esc_html( KGB_REVIEW_VERSION ); ?></strong></p>
                    </div>
                </div>
                <div class="pp-save"><?php submit_button( 'Mentés', 'primary', 'submit', false ); ?></div>
            </div>

        </form>
    </div>

    <script>
    // Aktív radio item vizuális kiemelése
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

// ─── Auto-lezárás napi futtatással ───────────────────────────────────────────

add_action( 'kgb_rv_auto_close_event', 'kgb_rv_run_auto_close' );

function kgb_rv_run_auto_close() {
    $days = (int) kgb_rv_opt( 'auto_close_days' );
    if ( $days <= 0 ) return;
    global $wpdb;
    $wpdb->query( $wpdb->prepare(
        "UPDATE {$wpdb->prefix}kgb_pins SET status = 'done', updated_at = %s
         WHERE status != 'done' AND created_at < DATE_SUB(NOW(), INTERVAL %d DAY)",
        current_time( 'mysql' ), $days
    ) );
}

register_activation_hook( KGB_REVIEW_MAIN_FILE, function () {
    if ( ! wp_next_scheduled( 'kgb_rv_auto_close_event' ) ) {
        wp_schedule_event( time(), 'daily', 'kgb_rv_auto_close_event' );
    }
} );

register_deactivation_hook( KGB_REVIEW_MAIN_FILE, function () {
    wp_clear_scheduled_hook( 'kgb_rv_auto_close_event' );
} );
