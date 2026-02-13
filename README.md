# PMAAS Basic Web UI

An implementation of the `spi.IPMAASRenderPlugin` interface that Provides a basic web-based user interface for a PMAAS
assembly.  Uses templates, so it requires the assembly to include a plugin that
implements `spi.IPMAASTemplateEnginePlugin`, such as
https://github.com/avanha/pmaas-plugin-golangtextteplate.

### Notes

The idea is that there can be different implementations of spi.IPMAASRenderPlugin.
This implementation obtains a type-specific render for each entity
and provides the wrapping interface around the entity