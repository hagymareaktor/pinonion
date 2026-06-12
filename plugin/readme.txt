=== PinOnion Website Review ===
Contributors: onionreactor
Tags: review, feedback, client feedback, design, collaboration
Requires at least: 6.0
Tested up to: 7.0
Stable tag: 0.9.1
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Lets your clients drop pins and leave feedback directly on any element of your live WordPress site for lightning-fast revisions.

== Description ==

**Currently in Open Beta (v0.9.1)**
We are currently in an open beta phase! This means the plugin is completely free to use without limitations while we gather feedback from the community for our upcoming v1.0 release. Try it out, and please let us know what features you'd like to see!

PinOnion is a visual feedback tool that allows you and your clients to drop feedback pins directly onto any element of your live WordPress website. Stop wasting time with spreadsheets and endless email chains.

Key Features:
* **Visual Pinning:** Click anywhere on your site to leave a comment attached to that specific HTML element.
* **Task Management:** Mark pins as Open, In Progress, or Done.
* **Modern Interface:** A sleek, floating interface that stays out of your way.
* **No Third-Party Tracking:** All your data stays securely on your own server.

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/pinonion` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Go to **Settings > PinOnion** to configure who can leave feedback.
4. Visit the front-end of your site and start dropping pins!

== Frequently Asked Questions ==

= Is this plugin free? =

Currently, PinOnion Website Review is in an Open Beta phase (v0.9.1), meaning all features are 100% free with no limitations. In the future, a premium/Pro version with advanced features will be introduced, but a robust free version will always remain available here.

= Can guest users leave feedback? =

No. At the moment, only logged-in WordPress users with the appropriate permissions can leave feedback or view the pins. Anonymous guest access is not currently supported.

= Does it work with page builders? =

Yes, PinOnion works as an overlay on top of your existing site, meaning it is perfectly compatible with Elementor, Divi, Gutenberg, and almost all other page builders and themes.

= Where is the data stored? =

All pins, comments, and feedback are stored entirely within your own WordPress database. We do not use external APIs or SaaS platforms to store your data, ensuring your clients' privacy.

= How do I control who can see or leave pins? =

You can easily configure user roles in the PinOnion settings page. You define which roles act as "Developers" (can see and manage all pins across the site) and which act as "Clients" (can only see and manage their own pins).

= Will this slow down my website? =

Not at all. The PinOnion scripts and styles are strictly loaded only for logged-in users who have permission to use the tool. Your regular website visitors will not download any extra code.

= Can clients close or resolve their own feedback? =

Yes, by default clients can mark their own pins as "Done". However, if you prefer strict control, you can disable this in the settings so only Developers can close tasks.

= What happens if I uninstall the plugin? =

By default, your feedback data is kept safe in the database in case you want to reinstall later. If you want to permanently wipe all pins, comments, and settings, you can enable the "Delete data on uninstall" option in the Advanced settings before removing the plugin.

== Screenshots ==

1. Dropping a new feedback pin on a live webpage.
2. The interactive PinOnion dashboard to manage open tasks.
3. Plugin settings page.

== Source Code ==

The source code and development files for this plugin are publicly available.
GitHub Repository: https://github.com/hagymareaktor/pinonion.git

== Changelog ==

= 0.9.1 =
* Renamed plugin to PinOnion Website Review to resolve trademark issues.
* Security: Updated REST API permissions to correctly verify specific plugin roles.
* Maintenance: Improved enqueueing of admin scripts and styles.
* Documentation: Added public GitHub repository link for source code accessibility.

= 0.9.0 =
* Initial public release on WordPress.org
