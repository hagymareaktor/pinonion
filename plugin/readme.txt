=== PurePin Review ===
Contributors: petercsontos
Tags: feedback, review, annotation, client, pin
Requires at least: 6.0
Tested up to: 6.5
Requires PHP: 7.4
Stable tag: 0.9.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Let your clients drop pins and leave feedback directly on any element of your live WordPress site for lightning-fast revisions.

== Description ==

PurePin Review adds a floating feedback button to your WordPress site, allowing clients to click any element on the page and leave a pin with a comment. Ideal for web agencies collecting client feedback during the review process.

**Features:**

* Click any element to drop a pin with a comment
* Pin status workflow: Open → In Progress → Done
* Guest and registered user support
* Optional access token (PIN code) protection
* Per-page or global pin view
* Auto-close pins after a configurable number of days
* WP-CLI commands for automation and AI tooling

== Installation ==

1. Upload the `purepin-review` folder to the `/wp-content/plugins/` directory.
2. Activate the plugin through the **Plugins** menu in WordPress.
3. Go to **Settings → PurePin Review** to configure access and notifications.
4. Share the `?review=1` link with your clients.

== Frequently Asked Questions ==

= Do clients need a WordPress account? =

No. You can enable guest mode so clients can drop pins using only their name, without registering.

= How do I protect the review link? =

Enable the PIN code option in Settings → Access. Clients will be prompted for the code when they open the `?review=1` link.

= Will the plugin interfere with my theme? =

The plugin only loads its assets when the `?review=1` parameter is present (or for logged-in editors). It does not affect public visitors.

== Screenshots ==

1. Feedback panel with pin list
2. Settings page — Access tab

== Changelog ==

= 0.9.0 =
* Initial Beta Release
