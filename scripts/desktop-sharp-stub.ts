/**
 * TechSpar only uses Transformers.js text feature-extraction pipelines.
 *
 * The Node distribution imports Sharp eagerly even though it is only used by
 * image pipelines. Keeping a native Sharp binary inside the backend executable
 * would add an unused platform dependency, so desktop builds replace it with a
 * fail-closed stub. If an image pipeline is introduced later, the build must be
 * changed to package Sharp explicitly.
 */
export default function unsupportedSharp(): never {
  throw new Error('Image pipelines are not available in the TechSpar desktop backend')
}
