const parsers = require("./index");

function detectImportType(context) {
  const scored = parsers.map((parser) => {
    let score = 0;

    try {
      score = Number(parser.detect(context) || 0);
    } catch (error) {
      score = 0;
    }

    return {
      id: parser.id,
      parser,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (!best || best.score <= 0) {
    return {
      detected: null,
      candidates: scored.map((item) => ({
        id: item.id,
        score: item.score,
      })),
    };
  }

  return {
    detected: best.parser,
    candidates: scored.map((item) => ({
      id: item.id,
      score: item.score,
    })),
  };
}

module.exports = detectImportType;