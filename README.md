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
