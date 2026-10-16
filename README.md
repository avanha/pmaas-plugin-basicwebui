# PMAAS Basic Web UI

An implementation of the `spi.IPMAASRenderPlugin` interface that Provides a basic web-based user interface for a PMAAS
assembly.  Uses templates, so it requires the assembly to include a plugin that
implements `spi.IPMAASTemplateEnginePlugin`, such as
https://github.com/avanha/pmaas-plugin-golangtextteplate.

### Notes

The idea is that there can be different implementations of spi.IPMAASRenderPlugin.
This implementation obtains a type-specific render for each entity
and provides the wrapping interface around the entity
### Alert indicator

While there are unacknowledged alerts, every page header shows an icon to the left of the time, in the colour of
the most severe one (blue `info`, amber `warning`, red `critical`), with the count in its tooltip. It follows the
`alert.SummaryEvent`s that the alert console plugin (`pmaas-plugin-alertconsole`) broadcasts, so it needs that
plugin in the assembly: without it there is nothing to show, and nothing else changes. An alert the user has
acknowledged in the console isn't counted, until it escalates.

### Icons

The icons every page uses are [Bootstrap Icons](https://icons.getbootstrap.com/) v1.11.3, served from this plugin's own
copy (`content/static/bootstrap-icons`, MIT licensed, with the source and how to update it noted beside it) and not from a
CDN, so pages keep their icons when the internet is down. Plugins whose templates use `bi bi-...` icons get them from
this layout, and don't need to load anything themselves.

## Page script: reload, and the critical-alert chime

Every page includes `js/page.js`, written as plain ES5 so that it runs on old browsers (an iPad that no longer
gets updates, say). It does two things:

- **Reload when idle.** The page reloads 30 seconds after it loaded, but never within 10 seconds of the last touch,
  scroll or key press, so using the menu isn't interrupted. Without scripts, the page falls back to a plain
  30-second `<meta refresh>` inside `<noscript>`.
- **Chime for critical alerts.** While the header's alert indicator is critical (the alert console reports an
  unacknowledged critical alert) the page plays a soft chime when it loads, at most about once a minute, and shows
  a speaker button beside the indicator. The button silences the chime for *that browser*; the choice is kept in
  `localStorage`, so it survives browser and device restarts. (In a private window it lasts only for the page.)

Browsers don't let a page make sound until someone has touched it, and Safari on an iPad asks again for every page
load. When the sound is blocked the button shows a crossed speaker, and the chime plays on the next touch (or press of
the button). A wall-mounted display that is never touched will therefore stay silent; a kiosk or browser flag that
allows autoplay is needed there.

The script is tested with node (`js_test/page_test.js`, run by `go test`; skipped when node isn't installed).
