const NEWS_API_BASE = "https://newsapi.org/v2";

// Valid NewsAPI category names
const VALID_CATEGORIES = [
  "business", "entertainment", "general", "health",
  "science", "sports", "technology",
];

/**
 * Fetch top headlines from NewsAPI.
 * @param {string[]} categories - e.g. ["technology", "sports"]
 * @param {number} totalCount - total articles to fetch across all categories
 */
async function getTopNews(categories = ["technology", "general"], totalCount = 10) {
  const apiKey = process.env.NEWS_API_KEY;

  // Clamp valid categories
  const validCats = categories.filter((c) => VALID_CATEGORIES.includes(c));
  if (validCats.length === 0) {
    return [];
  }

  const perCategory = Math.max(1, Math.ceil(totalCount / validCats.length));

  const results = await Promise.all(
    validCats.map(async (category) => {
      const res = await fetch(
        `${NEWS_API_BASE}/top-headlines?category=${category}&language=en&pageSize=${perCategory}&apiKey=${apiKey}`
      );
      const data = await res.json();

      if (data.status !== "ok") {
        console.warn(`[News] Failed to fetch category "${category}":`, data.message);
        return [];
      }

      return (data.articles || []).map((a) => ({
        title:       a.title,
        source:      a.source?.name || "Unknown",
        url:         a.url,
        publishedAt: a.publishedAt,
        category,
      }));
    })
  );

  return results.flat().slice(0, totalCount);
}

module.exports = { getTopNews, VALID_CATEGORIES };
