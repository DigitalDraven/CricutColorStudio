// Loads the pure image-processing functions out of js/app.js for Node tests (no DOM, no dependencies).
// It slices the file between two markers, so keep `function colorDist` and `function processImage` in place.
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8");
const a = src.indexOf("  function colorDist"), b = src.indexOf("  function processImage");
if (a < 0 || b < 0) throw new Error("tests/load-app.js: could not find the markers in js/app.js");
const names = ["colorDist","quantize","flattenTonalShades","mergeSimilarDarkColors","reduceToCount","smoothColorLabels",
  "fillTinyEnclosedHoles","findComponents","majorityFilter","reassignToNeighbor","absorbSmallComponents","protectSplitPieces",
  "simplifyLabelsForCutting","removeLikelySlivers","overlapMask","hexDist2","SIMPLIFY_LEVELS","TINY_MM2"];
module.exports = new Function(src.slice(a, b) + "\nreturn {" + names.join(",") + "};")();
