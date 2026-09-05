# AI-Powered WordPress Website Builder --- MVP Product & Feature Specification

## 1. Project Overview

The project is an **AI-native website builder built around WordPress**.

A user interacts with an AI agent through a conversational interface.
The agent:

1.  Understands the user's website idea.
2.  Gathers missing requirements.
3.  Converts requirements into a structured website specification.
4.  Recommends suitable native WordPress themes.
5.  Creates multiple theme/design variations.
6.  Creates an isolated WordPress environment inside Docker.
7.  Installs and activates the selected WordPress theme.
8.  Configures the theme and WordPress settings.
9.  Generates pages, navigation, content, sections, and styling.
10. Adds required plugins/features.
11. Creates child-theme/customization layers where appropriate.
12. Runs the generated site.
13. Shows a live preview inside the application.
14. Allows the user to request changes conversationally.
15. Applies changes without unnecessarily rebuilding the whole website.
16. Tests the generated website automatically.
17. Detects visual/functionality problems and fixes them.
18. Lets the user compare different versions/themes.
19. Saves the project state and version history.
20. Allows the finished website/project to be exported or prepared for
    deployment.

The MVP should therefore be treated as an **AI website-development
environment**, not simply an HTML generator or chatbot.

------------------------------------------------------------------------

# 2. Core MVP User Journey

The complete MVP flow should be:

``` text
User opens application
        ↓
Creates project
        ↓
AI asks requirements questions
        ↓
Requirements become structured specification
        ↓
AI recommends WordPress themes
        ↓
Theme previews/variants are generated
        ↓
User selects a theme
        ↓
Docker WordPress environment is created
        ↓
Theme + required plugins are installed
        ↓
AI configures WordPress
        ↓
AI generates pages/content/components
        ↓
Website becomes available
        ↓
Live preview shown
        ↓
User asks for changes
        ↓
AI modifies specification + implementation
        ↓
Website updates
        ↓
Automated functional tests
        ↓
Visual inspection
        ↓
AI fixes detected issues
        ↓
User approves final website
        ↓
Export/deployment package
```

------------------------------------------------------------------------

# 3. MVP Scope

The MVP must support:

-   Conversational website creation
-   Requirement gathering
-   Requirement clarification
-   Structured site specification
-   AI theme recommendations
-   Native WordPress theme installation
-   Theme activation
-   Theme configuration
-   Multiple design/theme variants
-   Dockerized WordPress environments
-   WordPress database provisioning
-   Plugin installation
-   Basic plugin configuration
-   Page generation
-   Navigation generation
-   Content generation
-   Design-system generation
-   Custom CSS
-   Child-theme/customization support
-   Live preview
-   Conversational modification
-   Versioning
-   Website screenshots
-   Automated browser testing
-   Basic visual quality checking
-   Error detection
-   AI-assisted fixes
-   Project persistence
-   Export
-   Basic security/isolation controls

------------------------------------------------------------------------

# 4. Product Architecture

Recommended high-level architecture:

``` text
                           USER
                             │
                             ▼
                    ┌─────────────────┐
                    │   Next.js UI    │
                    │ Chat + Preview  │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    AI AGENT     │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
 Requirements           Theme Engine         Plugin Engine
    Engine                  │                    │
        │                   ▼                    ▼
        └────────────── Site Specification ──────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ WordPress Agent  │
                    │ / Tool Layer     │
                    └────────┬────────┘
                             │
                  ┌──────────┼──────────┐
                  ▼          ▼          ▼
                REST       WP-CLI    Filesystem
                  │          │          │
                  └──────────┼──────────┘
                             ▼
                       Docker Engine
                             │
                             ▼
                  ┌─────────────────────┐
                  │ Isolated WordPress  │
                  │ + Database          │
                  │ + Theme             │
                  │ + Plugins           │
                  └──────────┬──────────┘
                             │
                             ▼
                       Live Preview
                             │
                             ▼
                  Playwright / Browser
                             │
                 ┌───────────┴──────────┐
                 ▼                      ▼
          Functional Tests        Visual Tests
                 │                      │
                 └───────────┬──────────┘
                             ▼
                         AI Critic
                             │
                         Fix Loop
```

------------------------------------------------------------------------

# 5. Frontend Application

## 5.1 Project Dashboard

The user needs a dashboard showing:

-   Projects
-   Project name
-   Project status
-   Last modified time
-   Current theme
-   WordPress environment status
-   Preview button
-   Edit button
-   Duplicate project
-   Delete project
-   Export project
-   Version history

Example project states:

``` text
Planning
Generating
Installing
Configuring
Testing
Ready
Error
Stopped
```

------------------------------------------------------------------------

# 6. AI Chat Interface

The chat interface is the primary control surface.

It must support:

-   User messages
-   AI responses
-   Streaming responses
-   Requirement questions
-   Suggested choices
-   Confirmation requests when necessary
-   Tool execution status
-   Generation progress
-   Error messages
-   Preview links
-   Theme recommendations
-   Change requests
-   Undo/rollback
-   Conversation history

Example:

``` text
User:
I need a website for my robotics startup.

AI:
What should the website focus on?

[Products]
[Services]
[Research]
[Portfolio]
[Everything]
```

The AI should avoid asking unnecessary questions when the user has
already supplied the information.

------------------------------------------------------------------------

# 7. Requirement Gathering Agent

The agent must transform vague requests into actionable requirements.

## Required capabilities

-   Identify website type
-   Identify target audience
-   Identify business/organization type
-   Identify required pages
-   Identify required functionality
-   Identify branding requirements
-   Identify color preferences
-   Identify typography preferences
-   Identify visual style
-   Identify layout preferences
-   Identify content requirements
-   Identify integrations
-   Identify forms
-   Identify e-commerce requirements
-   Identify blog/news requirements
-   Identify authentication requirements
-   Identify SEO requirements
-   Identify responsive requirements
-   Identify accessibility expectations

## Requirement clarification

The AI should identify missing information.

For example:

``` text
User:
Make me a website for a college robotics club.

AI:
I can build that. I need a few details:

1. Do you need event registration?
2. Do you want a project showcase?
3. Should students be able to contact the club?
4. Do you want a blog/news section?
5. What visual style do you prefer?
```

The AI should maintain a requirements state rather than repeatedly
asking the same questions.

------------------------------------------------------------------------

# 8. Structured Site Specification

The AI should never rely solely on conversation history.

It should create a structured internal specification.

Example:

``` json
{
  "site": {
    "name": "Robotics Club",
    "type": "organization",
    "industry": "education",
    "audience": ["students", "companies"]
  },
  "pages": [
    "home",
    "about",
    "projects",
    "events",
    "team",
    "contact"
  ],
  "features": [
    "event-registration",
    "project-showcase",
    "contact-form"
  ],
  "design": {
    "style": "futuristic",
    "mode": "dark",
    "primary_color": "#...",
    "font": "Inter"
  },
  "theme": {
    "selected": "...",
    "use_child_theme": true
  }
}
```

The specification should be the source of truth for the generated site.

------------------------------------------------------------------------

# 9. Design System Generation

The AI should generate a design system based on requirements.

It should define:

-   Primary color
-   Secondary color
-   Accent color
-   Background colors
-   Text colors
-   Font family
-   Heading hierarchy
-   Body typography
-   Button styles
-   Card styles
-   Border radius
-   Shadows
-   Spacing scale
-   Section spacing
-   Container width
-   Image treatment
-   Icon style
-   Animation level
-   Responsive breakpoints

Example:

``` text
Design
├── Colors
├── Typography
├── Spacing
├── Components
├── Buttons
├── Cards
├── Forms
├── Navigation
└── Responsive behavior
```

------------------------------------------------------------------------

# 10. WordPress Theme Discovery

The MVP must support existing/native WordPress themes.

The AI should be able to:

-   Discover available themes
-   Search themes
-   Filter themes
-   Identify theme category
-   Identify theme capabilities
-   Determine compatibility
-   Recommend themes
-   Rank themes
-   Explain why a theme was selected
-   Install selected theme
-   Activate selected theme

The system should distinguish between:

``` text
Available Theme
Installed Theme
Active Theme
Compatible Theme
Recommended Theme
```

------------------------------------------------------------------------

# 11. Theme Recommendation Engine

Theme recommendations should consider:

-   Website category
-   Visual style
-   Required layouts
-   Gutenberg/block support
-   Customization capabilities
-   Required plugins
-   Performance considerations
-   Mobile responsiveness
-   Existing components
-   Theme maturity
-   Compatibility with the generated site

Example:

``` text
User requirements
        ↓
Theme candidates
        ↓
Compatibility scoring
        ↓
Theme A — 94%
Theme B — 88%
Theme C — 81%
```

The AI should explain recommendations in human-readable language.

------------------------------------------------------------------------

# 12. Multiple Theme Variants

A major MVP feature is generating multiple design options.

Example:

``` text
Requirement Specification
          │
     ┌────┼────┐
     ▼    ▼    ▼
 Minimal Modern Corporate
     │    │    │
     ▼    ▼    ▼
 Variant A B    C
```

Each variant should be previewable.

The user should be able to:

-   Compare variants
-   Select a variant
-   Switch themes
-   Keep the content while changing the design
-   Ask the AI to combine characteristics
-   Save preferred variants

Example:

> "I like the layout of Theme A but the colors of Theme C."

The agent should create a new configuration based on both.

------------------------------------------------------------------------

# 13. Dockerized WordPress Environment

Every project should have an isolated WordPress environment.

Recommended structure:

``` text
Project
├── WordPress container
├── Database container
├── Optional reverse proxy
├── Project volume
└── Generated assets
```

The system must support:

-   Creating containers
-   Starting containers
-   Stopping containers
-   Restarting containers
-   Destroying containers
-   Recreating containers
-   Persistent volumes
-   Project-specific configuration
-   Environment variables
-   Database initialization
-   Port allocation
-   Health checks
-   Container status monitoring

------------------------------------------------------------------------

# 14. Local Preview Environment

Each generated website must receive a preview endpoint.

Example:

``` text
Project
   ↓
Docker WordPress
   ↓
Local preview URL
   ↓
Embedded application preview
```

The UI should show:

-   Desktop preview
-   Tablet preview
-   Mobile preview
-   Refresh
-   Open in new tab
-   Current generation status

------------------------------------------------------------------------

# 15. WordPress Installation Automation

The agent must automate:

-   WordPress installation
-   Database connection
-   Admin creation
-   Site title
-   Site URL
-   Permalink configuration
-   Timezone
-   Language
-   Basic settings
-   Media settings
-   User roles

The credentials should be managed securely and not exposed to the LLM
unnecessarily.

------------------------------------------------------------------------

# 16. WordPress Agent Tool Layer

The AI should interact with WordPress through controlled tools.

Core tools:

``` text
create_project()
get_project_state()
start_wordpress()
stop_wordpress()
restart_wordpress()
install_theme()
activate_theme()
install_plugin()
activate_plugin()
configure_theme()
configure_plugin()
create_page()
update_page()
delete_page()
create_post()
update_post()
create_menu()
update_menu()
upload_media()
update_site_settings()
run_wp_cli()
run_wordpress_api()
create_child_theme()
modify_child_theme()
add_custom_css()
run_tests()
capture_screenshot()
```

The AI should not have unrestricted host access.

------------------------------------------------------------------------

# 17. Theme Adapter Layer

Different WordPress themes expose different customization systems.

The MVP should introduce an abstraction:

``` text
AI
 ↓
Theme Adapter
 ↓
Gutenberg Adapter
Elementor Adapter
Block Theme Adapter
Custom Theme Adapter
 ↓
WordPress
```

The adapter should expose capabilities such as:

-   Install
-   Activate
-   Configure
-   Identify templates
-   Identify customization options
-   Modify colors
-   Modify typography
-   Modify layout
-   Add sections
-   Modify navigation
-   Preserve theme updates where possible

The MVP can initially prioritize block/Gutenberg-compatible themes and
add specialized builders later.

------------------------------------------------------------------------

# 18. Child Theme Support

When extensive customization is needed, the system should prefer a
child-theme/customization layer instead of modifying third-party theme
source files directly.

Example:

``` text
Parent Theme
      │
      ▼
AI-generated Child Theme
      │
      ├── style overrides
      ├── template overrides
      ├── custom functions
      └── custom assets
```

Requirements:

-   Detect whether child theme is appropriate
-   Generate child theme
-   Activate child theme
-   Store customizations separately
-   Preserve parent theme
-   Support rollback

------------------------------------------------------------------------

# 19. Page Generation

The AI should create pages based on the site specification.

Supported MVP pages:

-   Home
-   About
-   Services
-   Products
-   Portfolio
-   Projects
-   Team
-   Contact
-   FAQ
-   Blog/News
-   Events
-   Careers
-   Custom pages

The user should be able to request additional pages conversationally.

------------------------------------------------------------------------

# 20. Page Structure Generation

The AI should generate sections such as:

``` text
Hero
↓
Introduction
↓
Features
↓
Statistics
↓
Services
↓
Products
↓
Projects
↓
Testimonials
↓
Team
↓
FAQ
↓
CTA
↓
Footer
```

The exact sections should depend on the website type.

------------------------------------------------------------------------

# 21. Component System

The MVP should support reusable components.

Core components:

-   Navbar
-   Hero
-   Heading
-   Paragraph
-   Button
-   Image
-   Image gallery
-   Card
-   Feature grid
-   Pricing table
-   Stats
-   Testimonial
-   Team member
-   Product card
-   Project card
-   Blog card
-   Event card
-   FAQ accordion
-   Contact form
-   Newsletter form
-   CTA
-   Footer

Components should be reusable across pages.

------------------------------------------------------------------------

# 22. AI Content Generation

The AI should be capable of generating:

-   Headlines
-   Subheadings
-   Paragraphs
-   Product descriptions
-   Service descriptions
-   FAQs
-   Calls to action
-   About sections
-   Team descriptions
-   Project descriptions
-   Blog drafts
-   Meta descriptions

The system should avoid inventing critical factual claims without
user-provided information.

------------------------------------------------------------------------

# 23. Navigation Generation

The agent should automatically:

-   Create primary menu
-   Create secondary navigation where needed
-   Add pages
-   Reorder pages
-   Add external links
-   Configure dropdowns
-   Add footer navigation

Example:

``` text
Home
About
Projects
Services
Blog
Contact
```

------------------------------------------------------------------------

# 24. Media Handling

The MVP should support:

-   Image uploads
-   Logo upload
-   Favicon/site icon
-   Image placement
-   Alt text
-   Basic image optimization
-   Media library management

AI-generated media can be an optional extension, but the MVP should at
minimum support user-provided media and placeholder assets.

------------------------------------------------------------------------

# 25. Plugin Management

The AI should be able to determine when plugins are required.

Examples:

``` text
Contact form → Form plugin
E-commerce → WooCommerce
SEO → SEO plugin
Caching → Cache plugin
Security → Security plugin
```

The system should:

-   Discover plugins
-   Recommend plugins
-   Install plugins
-   Activate plugins
-   Configure supported plugin settings
-   Track installed plugins
-   Detect plugin dependencies
-   Detect compatibility problems

The MVP should maintain an allowlist of trusted plugins rather than
allowing arbitrary plugin installation without controls.

------------------------------------------------------------------------

# 26. Plugin Configuration

Plugin configuration should be represented as structured operations.

Example:

``` text
Install plugin
↓
Activate plugin
↓
Configure
↓
Create required entities
↓
Connect to generated pages
↓
Test
```

The agent should know whether a plugin is:

-   Installed
-   Active
-   Configured
-   Required
-   Compatible
-   Failed

------------------------------------------------------------------------

# 27. Conversational Website Editing

After initial generation, the user should be able to say:

> Make the hero bigger.

> Change the site to dark blue.

> Remove testimonials.

> Add a careers page.

> Make the buttons rounded.

> Use the layout from Theme B.

> Make it more premium.

> Make the mobile version cleaner.

The AI should translate these requests into targeted modifications.

------------------------------------------------------------------------

# 28. Incremental Modification

The agent should not rebuild the entire website for every small change.

Preferred flow:

``` text
User request
     ↓
Determine affected specification
     ↓
Determine affected components
     ↓
Modify implementation
     ↓
Test affected area
     ↓
Update preview
```

Example:

``` text
"Change button color"
```

should not trigger a complete website regeneration.

------------------------------------------------------------------------

# 29. AI Design Critic

The MVP should include a basic visual-quality loop.

Process:

``` text
Generate
   ↓
Render
   ↓
Screenshot
   ↓
AI visual inspection
   ↓
Identify problems
   ↓
Fix
   ↓
Render again
```

The critic should inspect:

-   Spacing
-   Alignment
-   Typography
-   Contrast
-   Overflow
-   Broken layouts
-   Empty sections
-   Visual hierarchy
-   Mobile responsiveness
-   Button visibility
-   Navigation issues
-   Image scaling

------------------------------------------------------------------------

# 30. Browser Automation

Use a browser automation layer such as Playwright.

The system should be able to:

-   Open pages
-   Click links
-   Fill forms
-   Submit forms
-   Check navigation
-   Test buttons
-   Check responsive layouts
-   Capture screenshots
-   Inspect console errors
-   Detect HTTP errors
-   Detect broken links

------------------------------------------------------------------------

# 31. Automated Testing

Minimum MVP test suite:

``` text
✓ Homepage loads
✓ Every generated page loads
✓ Navigation works
✓ Internal links work
✓ Buttons have destinations/actions
✓ Forms render
✓ Images load
✓ No major HTTP errors
✓ No critical browser console errors
✓ Desktop layout works
✓ Mobile layout works
✓ Tablet layout works
```

Testing should happen after generation and after significant
modifications.

------------------------------------------------------------------------

# 32. Error Recovery

If generation fails, the system should:

1.  Capture error.
2.  Classify error.
3.  Identify responsible operation.
4.  Attempt a safe fix.
5.  Retry.
6.  Re-test.
7.  Report failure if the retry limit is exceeded.

Example:

``` text
Plugin installation failed
        ↓
Check dependency
        ↓
Fix dependency
        ↓
Retry installation
        ↓
Test
```

------------------------------------------------------------------------

# 33. Generation State Machine

The application should track generation state.

Recommended states:

``` text
CREATED
↓
REQUIREMENTS
↓
SPECIFICATION_READY
↓
THEME_SELECTION
↓
ENVIRONMENT_CREATING
↓
WORDPRESS_READY
↓
THEME_INSTALLING
↓
PLUGINS_INSTALLING
↓
GENERATING
↓
CONFIGURING
↓
TESTING
↓
VISUAL_REVIEW
↓
READY
```

Failure states should be recoverable.

------------------------------------------------------------------------

# 34. Version History

Every significant generation/change should create a version.

Example:

``` text
Version 1
Initial website

Version 2
Dark theme

Version 3
Added projects page

Version 4
Changed navigation

Version 5
Mobile fixes
```

Required actions:

-   View versions
-   Compare versions
-   Restore version
-   Create checkpoint
-   Undo latest change

------------------------------------------------------------------------

# 35. Site Specification vs WordPress State

The system should maintain two related states:

``` text
AI Site Specification
        │
        ▼
Desired State

WordPress Instance
        │
        ▼
Actual State
```

The agent should be able to compare:

``` text
Desired State
      vs
Actual State
```

and reconcile differences.

This prevents the AI from losing track of what has already been built.

------------------------------------------------------------------------

# 36. Project Persistence

Persist:

-   Project metadata
-   User requirements
-   Conversation
-   Site specification
-   Selected theme
-   Theme configuration
-   Plugin configuration
-   Generated pages
-   Versions
-   Docker environment information
-   Test results
-   Screenshots
-   Error logs

------------------------------------------------------------------------

# 37. Project Isolation

Each project should be isolated.

A project should not be able to accidentally access:

-   Another project's files
-   Another project's database
-   Host secrets
-   Host filesystem
-   Other containers

The architecture should use:

-   Container isolation
-   Restricted filesystem access
-   Resource limits
-   Controlled Docker API access
-   Separate project volumes
-   Secrets management

------------------------------------------------------------------------

# 38. Security

Security is a core MVP requirement because the agent is capable of
executing operations.

The system must:

-   Avoid unrestricted shell access
-   Restrict Docker operations
-   Validate tool parameters
-   Sanitize generated code
-   Protect WordPress credentials
-   Protect API keys
-   Avoid exposing secrets to the model
-   Restrict filesystem operations
-   Restrict network access where possible
-   Use trusted plugin/theme sources
-   Log tool calls
-   Log destructive operations
-   Require confirmation for destructive actions when appropriate

------------------------------------------------------------------------

# 39. AI Tool Permissions

Tools should be categorized.

### Read-only

``` text
get_project_state
get_theme_info
get_plugin_info
read_page
get_site_settings
get_test_results
```

### Write

``` text
create_page
update_page
configure_theme
install_plugin
modify_child_theme
```

### Destructive

``` text
delete_page
delete_project
destroy_container
remove_plugin
reset_site
```

Destructive operations should have stronger safeguards.

------------------------------------------------------------------------

# 40. Observability

The application should provide logs for:

-   AI actions
-   Tool calls
-   WordPress operations
-   Docker operations
-   Plugin installation
-   Theme installation
-   Test results
-   Errors
-   Generation duration

Example:

``` text
17:04:12  Creating WordPress container
17:04:18  Database ready
17:04:21  Installing theme
17:04:28  Theme activated
17:04:31  Creating homepage
17:04:42  Running browser tests
17:04:49  14/14 tests passed
```

------------------------------------------------------------------------

# 41. Progress UI

Long-running operations need visible progress.

Example:

``` text
Building your website...

✓ Requirements analyzed
✓ Theme selected
✓ WordPress created
✓ Theme installed
✓ Plugins installed
✓ Pages generated
● Running tests
○ Visual review
```

This is important because AI generation and Docker operations may take
time.

------------------------------------------------------------------------

# 42. Responsive Preview

The preview interface should support:

``` text
Desktop
Tablet
Mobile
```

The user should be able to switch viewport sizes.

The system should use browser automation to test these views.

------------------------------------------------------------------------

# 43. Theme Switching After Generation

The user should be able to say:

> "Try the website with a different theme."

The agent should:

1.  Preserve site requirements.
2.  Preserve content where possible.
3.  Select another compatible theme.
4.  Install/activate it.
5.  Map content to the new theme.
6.  Reapply supported design requirements.
7.  Test the result.
8.  Show the new preview.

------------------------------------------------------------------------

# 44. Theme Comparison

The UI should support comparison of:

``` text
Theme A
Theme B
Theme C
```

For each:

-   Screenshot
-   Theme name
-   Compatibility score
-   Strengths
-   Weaknesses
-   Required plugins
-   Customization difficulty

------------------------------------------------------------------------

# 45. Basic SEO

MVP should provide:

-   Page titles
-   Meta descriptions
-   Heading hierarchy
-   Image alt text
-   Clean permalinks
-   Sitemap compatibility
-   Basic SEO plugin integration if selected

Advanced SEO can be deferred.

------------------------------------------------------------------------

# 46. Accessibility

Minimum MVP accessibility checks:

-   Image alt text
-   Heading hierarchy
-   Button labels
-   Link labels
-   Color contrast where detectable
-   Keyboard accessibility for core navigation
-   Form labels
-   Basic ARIA correctness

Accessibility should be part of the automated quality check.

------------------------------------------------------------------------

# 47. Performance

The MVP should monitor obvious performance problems.

Check:

-   Excessive image sizes
-   Large assets
-   Too many plugins
-   Slow page loading
-   Broken caching configuration
-   Excessive scripts
-   Layout shifts where detectable

The agent should provide basic optimization suggestions.

------------------------------------------------------------------------

# 48. Export

The user should be able to export the finished project.

Possible MVP export:

``` text
Project ZIP
├── WordPress theme
├── Child theme
├── Custom plugin(s)
├── Configuration
├── Content
├── Media
├── Docker configuration
└── Documentation
```

A Docker Compose package is especially useful for reproducibility.

------------------------------------------------------------------------

# 49. Deployment Preparation

Full cloud deployment does not have to be part of the first MVP, but the
architecture should support it.

The MVP should at least provide:

-   Exportable Docker setup
-   Environment configuration
-   Site backup
-   Database export
-   Filesystem export
-   Deployment instructions

Future deployment targets can include VPS/cloud hosting.

------------------------------------------------------------------------

# 50. Backup and Restore

MVP should support:

-   Project snapshot
-   WordPress database backup
-   WordPress files backup
-   Restore checkpoint
-   Restore previous version

This is particularly important because the AI is modifying a live
generated environment.

------------------------------------------------------------------------

# 51. AI Agent Memory

The agent should remember project-specific facts:

``` text
Project requirements
Design decisions
Selected theme
Rejected themes
User preferences
Implemented pages
Installed plugins
Known limitations
Previous changes
```

It should not repeatedly ask:

> "What color do you want?"

after the user already answered it.

------------------------------------------------------------------------

# 52. AI Planning

For complex requests, the agent should produce an internal execution
plan.

Example:

``` text
Request:
Create a restaurant website with online ordering.

Plan:
1. Update site specification
2. Select compatible theme
3. Install WooCommerce
4. Configure store
5. Create menu structure
6. Create homepage
7. Create menu page
8. Create checkout-related pages
9. Configure navigation
10. Apply design system
11. Test ordering flow
12. Run responsive tests
13. Fix issues
```

The user can see high-level progress without exposing hidden reasoning.

------------------------------------------------------------------------

# 53. AI Validation

Before executing major changes, the agent should validate:

-   Required dependencies
-   Theme compatibility
-   Plugin compatibility
-   Existing site state
-   Conflicting configurations
-   Whether requested feature is supported
-   Whether an operation is destructive

------------------------------------------------------------------------

# 54. AI Change Impact Analysis

Before changing a shared component, the agent should determine affected
areas.

Example:

``` text
Change:
Navbar

Affected:
✓ Home
✓ About
✓ Projects
✓ Contact
✓ Mobile navigation
```

Then test those affected areas.

------------------------------------------------------------------------

# 55. Safe Regeneration

If a generated page becomes corrupted, the system should allow:

``` text
Regenerate page
Regenerate section
Restore previous version
Regenerate theme
Reset project
```

without necessarily destroying the entire project.

------------------------------------------------------------------------

# 56. User Approval Points

The MVP should allow optional confirmation before:

-   Destroying a project
-   Resetting WordPress
-   Changing themes
-   Removing plugins
-   Deleting pages
-   Replacing large sections
-   Performing potentially irreversible operations

Routine generation should remain automatic to preserve the "agent"
experience.

------------------------------------------------------------------------

# 57. Database Model

A reasonable MVP database structure:

``` text
users
projects
project_requirements
conversations
messages
site_specifications
themes
project_themes
plugins
project_plugins
pages
components
versions
tool_executions
test_runs
test_results
screenshots
docker_environments
logs
```

------------------------------------------------------------------------

# 58. Suggested Technology Stack

## Frontend

``` text
Next.js
React
TypeScript
Tailwind CSS
```

Optional:

``` text
Monaco Editor
WebSocket/SSE
```

## AI/Agent Backend

Either:

``` text
Python
FastAPI
```

or:

``` text
Node.js
TypeScript
```

The AI layer should support:

-   Tool calling
-   Structured outputs
-   Streaming
-   Agent state
-   Retry handling
-   Validation

## WordPress

``` text
WordPress
PHP
MySQL/MariaDB
REST API
WP-CLI
```

## Infrastructure

``` text
Docker
Docker Compose
Nginx
Redis
```

## Browser Testing

``` text
Playwright
Chromium
```

## Persistence

A separate application database can use:

``` text
PostgreSQL
```

while WordPress uses its normal MySQL/MariaDB database.

------------------------------------------------------------------------

# 59. Recommended Repository Structure

``` text
ai-wordpress-builder/
│
├── apps/
│   ├── web/
│   │   └── Next.js application
│   │
│   └── agent/
│       └── AI agent server
│
├── packages/
│   ├── site-spec/
│   ├── agent-tools/
│   ├── theme-engine/
│   ├── plugin-engine/
│   ├── wordpress-adapter/
│   ├── testing/
│   └── shared/
│
├── infrastructure/
│   ├── docker/
│   ├── wordpress/
│   └── nginx/
│
├── templates/
│   ├── child-theme/
│   ├── plugins/
│   └── docker/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── docs/
```

------------------------------------------------------------------------

# 60. MVP UI Screens

The MVP should have at least:

## Screen 1 --- Dashboard

``` text
Projects
+ New Project

Project cards
```

## Screen 2 --- Create Project

``` text
Chat with AI
```

## Screen 3 --- Requirements

``` text
Requirements summary
Edit requirements
Continue
```

## Screen 4 --- Theme Selection

``` text
Theme A
Theme B
Theme C
```

## Screen 5 --- Builder

``` text
Chat
+
Live Preview
```

## Screen 6 --- Versions

``` text
Version history
Restore
Compare
```

## Screen 7 --- Project Settings

``` text
WordPress
Theme
Plugins
Environment
Export
```

------------------------------------------------------------------------

# 61. Example End-to-End Scenario

User:

> "Create a website for a futuristic robotics startup."

AI:

``` text
Understood.

I recommend:
- Home
- About
- Products
- Research
- Projects
- Team
- Contact

I also recommend a futuristic dark visual direction.

Would you like me to show three theme variations?
```

User:

> "Yes."

System:

``` text
Generating:

1. Minimal Tech
2. Futuristic Glass
3. Premium Corporate
```

User selects:

``` text
Futuristic Glass
```

System:

``` text
✓ Creating Docker environment
✓ Installing WordPress
✓ Installing theme
✓ Configuring theme
✓ Creating pages
✓ Creating navigation
✓ Applying design system
✓ Running tests
```

User:

> "Make the hero less purple and add a product showcase."

AI:

``` text
✓ Updated design system
✓ Added product showcase
✓ Updated homepage
✓ Tested homepage
✓ Updated preview
```

User:

> "Make mobile navigation better."

AI:

``` text
✓ Updated mobile navigation
✓ Tested mobile viewport
✓ No critical issues detected
```

The website is now ready for export/deployment.

------------------------------------------------------------------------

# 62. MVP Definition of Done

The MVP should be considered complete only when a user can perform this
entire flow without manually editing WordPress code:

``` text
1. Create project
2. Describe website
3. Answer AI questions
4. Receive requirements summary
5. Receive theme recommendations
6. Preview multiple variants
7. Select a theme
8. Create isolated Docker WordPress
9. Install WordPress
10. Install/activate theme
11. Install required plugins
12. Configure theme/plugins
13. Generate pages
14. Generate content
15. Generate navigation
16. Apply design system
17. Open live preview
18. Request modifications through chat
19. Apply incremental changes
20. Run automated tests
21. Perform visual inspection
22. Fix detected issues
23. Save version
24. Restore a version
25. Export the finished project
```

If any of these requires the developer to manually intervene for normal
use, that capability should be treated as incomplete.

------------------------------------------------------------------------

# 63. Features Explicitly Deferred Beyond MVP

The following are valuable but should not block the first working
product:

-   Full cloud deployment automation
-   Custom-domain provisioning
-   Multi-user collaborative editing
-   Marketplace for AI-generated themes
-   AI-generated stock photography pipeline
-   Full Elementor/Divi/custom-builder adapters
-   Advanced WooCommerce workflows
-   Advanced membership systems
-   Advanced analytics
-   Automated A/B testing
-   Multi-agent autonomous development teams
-   Automatic production scaling
-   Managed hosting
-   Billing/subscriptions
-   White-labeling
-   Enterprise SSO
-   Large-scale multi-tenant orchestration

The architecture should leave room for these features later.

------------------------------------------------------------------------

# 64. Most Important Engineering Principle

The central architectural principle should be:

``` text
User Intent
     ↓
Requirements
     ↓
Structured Site Specification
     ↓
AI Planning
     ↓
Controlled Tools
     ↓
WordPress
     ↓
Browser Testing
     ↓
Visual Validation
     ↓
Correction
     ↓
Approved Website
```

Do **not** make the LLM the direct source of truth for the entire
application.

The structured site specification, project state, WordPress state, tool
layer, and test system should provide deterministic structure around the
AI.

------------------------------------------------------------------------

# 65. Final MVP Feature Checklist

## AI

-   [ ] Conversational interface
-   [ ] Requirement gathering
-   [ ] Requirement clarification
-   [ ] Structured site specification
-   [ ] AI planning
-   [ ] Theme recommendation
-   [ ] Plugin recommendation
-   [ ] Content generation
-   [ ] Design-system generation
-   [ ] Conversational editing
-   [ ] Incremental modifications
-   [ ] Change impact analysis
-   [ ] Error recovery
-   [ ] AI visual critic

## WordPress

-   [ ] Automated installation
-   [ ] Theme discovery
-   [ ] Theme installation
-   [ ] Theme activation
-   [ ] Theme configuration
-   [ ] Multiple theme variants
-   [ ] Theme switching
-   [ ] Child themes
-   [ ] Plugin discovery
-   [ ] Plugin installation
-   [ ] Plugin activation
-   [ ] Plugin configuration
-   [ ] Page creation
-   [ ] Page modification
-   [ ] Navigation generation
-   [ ] Content generation
-   [ ] Media handling
-   [ ] Custom CSS
-   [ ] WordPress REST API
-   [ ] WP-CLI integration

## Docker

-   [ ] Project isolation
-   [ ] WordPress container
-   [ ] Database container
-   [ ] Persistent volumes
-   [ ] Container lifecycle management
-   [ ] Health checks
-   [ ] Environment management
-   [ ] Preview URLs
-   [ ] Resource controls

## Preview

-   [ ] Live website preview
-   [ ] Desktop preview
-   [ ] Tablet preview
-   [ ] Mobile preview
-   [ ] Screenshot capture
-   [ ] Theme comparison

## Testing

-   [ ] Page load testing
-   [ ] Navigation testing
-   [ ] Link testing
-   [ ] Form testing
-   [ ] Button testing
-   [ ] Image testing
-   [ ] HTTP error detection
-   [ ] Browser console error detection
-   [ ] Responsive testing
-   [ ] Accessibility checks
-   [ ] Basic performance checks
-   [ ] Visual inspection

## Project Management

-   [ ] Project dashboard
-   [ ] Project state
-   [ ] Conversation persistence
-   [ ] Requirements persistence
-   [ ] Site specification persistence
-   [ ] Version history
-   [ ] Checkpoints
-   [ ] Undo/rollback
-   [ ] Logs
-   [ ] Test history
-   [ ] Backup/restore
-   [ ] Export

## Security

-   [ ] Tool permissions
-   [ ] Restricted Docker access
-   [ ] Filesystem isolation
-   [ ] Secret protection
-   [ ] Trusted theme/plugin sources
-   [ ] Operation logging
-   [ ] Destructive-operation safeguards
-   [ ] Project isolation

------------------------------------------------------------------------

# 66. Final Product Vision

The MVP should feel like:

``` text
                 ┌─────────────────────────┐
                 │   "Build me a website"  │
                 └────────────┬────────────┘
                              │
                              ▼
                     AI Website Architect
                              │
                 ┌────────────┴────────────┐
                 │                         │
                 ▼                         ▼
          Existing Themes            AI Customization
                 │                         │
                 └────────────┬────────────┘
                              ▼
                         WordPress
                              │
                              ▼
                           Docker
                              │
                              ▼
                       Live Website
                              │
                              ▼
                    AI Test + Critic
                              │
                              ▼
                         Auto-Fix
                              │
                              ▼
                      Production Ready
```

The defining feature of the product is not simply that AI can generate a
WordPress site.

It is that **the AI can understand intent, choose from existing
WordPress capabilities, create a working isolated environment, assemble
a website, visually evaluate it, accept natural-language changes, and
continuously bring the implementation into alignment with the user's
requested design and functionality.**

That combination is the core MVP.
