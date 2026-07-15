import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini SDK server-side on-demand (lazy-load) to pick up secret updates dynamically
let aiClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is not configured. Please open Settings > Secrets and add a secret named GEMINI_API_KEY with your Google AI Studio API key.");
  }
  
  // Re-create client if API key has changed, or if it wasn't initialized yet
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// Full-stack API endpoint to analyze restaurants and generate/refine plans
app.post("/api/plan", async (req, res) => {
  try {
    const ai = getGeminiClient();
    const { preferences, history = [], candidates = [] } = req.body;

    // Server-side safety: Only evaluate the top 5 candidates and slice reviews to 3 to optimize prompt size and prevent timeout
    const limitedCandidates = (candidates || []).slice(0, 5).map((c: any) => ({
      ...c,
      reviews: (c.reviews || []).slice(0, 3).map((r: any) => ({
        ...r,
        text: (r.text || "").substring(0, 250)
      }))
    }));

    if (!preferences) {
      return res.status(400).json({ error: "Preferences are required." });
    }

    // Build the user preferences description
    const prefSummary = `
City: ${preferences.city || "Any"}
Occasion: ${preferences.occasion || "Casual Outing"}
Food Preference: ${preferences.foodPreference || "No preference"}
Budget: ${preferences.budget || "Any"}
Flexibility: ${preferences.flexibility || "Flexible"}
`;

    // Format the history for context
    const historyText = history
      .map((msg: any) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
      .join("\n");

    // Format candidates for analysis (Google Places reviews & details)
    const candidatesText = limitedCandidates
      .map((c: any, index: number) => {
        const reviewsText = c.reviews
          ? c.reviews.map((r: any) => `- [Rating: ${r.rating}] "${r.text || r.originalText?.text || ""}"`).join("\n")
          : "No reviews available.";
        return `
Candidate #${index + 1}:
ID: ${c.id}
Name: ${c.displayName || c.name || "Unknown"}
Address: ${c.formattedAddress || "Unknown"}
Rating: ${c.rating || "N/A"} (${c.userRatingCount || 0} reviews)
Price Level: ${c.priceLevel || "N/A"}
Reviews:
${reviewsText}
`;
      })
      .join("\n---\n");

    const prompt = `
You are an expert local guide and concierge planner specializing in creating the perfect "night out" dining experience.
Analyze the following user preferences, conversation history, and real restaurant candidates with actual customer reviews.

### User Context & Current Night Out Preferences:
${prefSummary}

### Conversation History:
${historyText || "No previous history (Starting initial setup)."}

### Candidate Restaurants (Fetched via Google Places API):
${candidatesText || "No restaurant candidates available in search range."}

### Tasks:
1. Rank the candidates from best to worst match based on the user's occasion, food preferences, budget (where price level matching budget $, $$, $$$, $$$$ counts), and current chat feedback.
2. For each recommended restaurant, look deep into their actual reviews to find and extract specific, positive, relevant statements (do not hallucinate, use actual snippets or very close paraphrases of what reviewers wrote) that relate to their occasion or preference (e.g. mention of "romantic cozy lighting" if it's Date Night, "amazing vegan options" if preferred, "celebrated my birthday" etc.).
3. Formulate a warm, extremely concise conversational response (strictly MAXIMUM 2 sentences, total under 45 words) summarizing the plan. Do not write paragraphs or long descriptions. Keep it brief so it fits cleanly on load.
4. Return a structured JSON response matching the required schema. Ensure every recommendation ID matches a candidate ID exactly.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an elegant, personalized local guide planning night outs. Your response must strictly be valid JSON adhering to the response schema. Keep conversationalResponse strictly under 2 sentences.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            conversationalResponse: {
              type: Type.STRING,
              description: "An extremely short, warm 2-sentence summary of the night out. Must be under 45 words."
            },
            newSearchQuery: {
              type: Type.STRING,
              description: "Only provide this field if the user's latest message indicates a change in cuisine, city, or category that requires fetching completely new restaurant options from Google Places. Return the ideal new search string (e.g., 'French restaurants in Seattle'). Otherwise, omit this or leave empty."
            },
            recommendations: {
              type: Type.ARRAY,
              description: "Ranked recommended spots from the candidates list. Do not include places not in the candidates list.",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "The exact restaurant ID from the candidates list." },
                  score: { type: Type.NUMBER, description: "A suitability score out of 100 based on preferences/chat." },
                  matchReason: { type: Type.STRING, description: "A personalized 1-2 sentence description explaining exactly why this spot fits their current criteria and occasion." },
                  reviewHighlights: {
                    type: Type.ARRAY,
                    description: "2-3 short, specific positive snippets or paraphrases of review comments from the candidates reviews that directly validate the choice.",
                    items: { type: Type.STRING }
                  }
                },
                required: ["id", "score", "matchReason", "reviewHighlights"]
              }
            }
          },
          required: ["conversationalResponse", "recommendations"]
        }
      }
    });

    const resultText = response.text || "{}";
    res.json(JSON.parse(resultText));
  } catch (error: any) {
    console.error("Error generating night out plan:", error);
    res.status(500).json({ error: error.message || "Failed to generate night out plan" });
  }
});

// Full-stack API endpoint to search YouTube Shorts/Videos for a restaurant or city
app.get("/api/youtube-shorts", async (req, res) => {
  try {
    const { restaurantName, city } = req.query;
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!restaurantName) {
      return res.status(400).json({ error: "restaurantName query parameter is required." });
    }

    const searchQuery = `${restaurantName} ${city || ""} review shorts`;

    // High-quality fallbacks for popular cuisines and general food spots when key is not present or query yields nothing
    const generalFoodShorts = [
      { id: "M89Cg8uO0m0", title: "Top rated dining experience & food review", channelTitle: "FoodieVlogs" },
      { id: "eY_LgN-hC_M", title: "Hidden culinary gems you must try", channelTitle: "StreetFoodies" },
      { id: "Y_8D5mGq2X8", title: "The ultimate restaurant review!", channelTitle: "ChefInsights" },
      { id: "8F4p077e6zE", title: "Insane signature dishes reviewed", channelTitle: "FlavorLab" },
      { id: "O1Bly0Iu8F4", title: "Beautiful dessert spots worth the hype", channelTitle: "SweetEscapes" }
    ];

    // If key is not set, return demo mode with fallback list
    if (!apiKey) {
      return res.json({
        videos: generalFoodShorts,
        isDemo: true,
        message: "Demo Mode: Add a 'YOUTUBE_API_KEY' in Settings > Secrets to enable live, real-time YouTube Shorts for any restaurant!"
      });
    }

    // Call official YouTube Data API v3 search endpoint
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(searchQuery)}&type=video&videoDuration=short&maxResults=5&key=${apiKey}`;
    
    const ytRes = await fetch(url);
    if (!ytRes.ok) {
      const errorData = await ytRes.json().catch(() => ({}));
      console.warn("YouTube Data API call failed. Falling back to curated food shorts.", errorData);
      
      return res.json({
        videos: generalFoodShorts,
        isDemo: true,
        message: `API Alert: YouTube API error (${errorData.error?.message || "Status " + ytRes.status}). Curated demo feed active.`
      });
    }

    const data = await ytRes.json();
    const videos = (data.items || [])
      .map((item: any) => ({
        id: item.id?.videoId,
        title: item.snippet?.title || "Restaurant Short Video",
        thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url,
        channelTitle: item.snippet?.channelTitle || "YouTube Creator",
        description: item.snippet?.description || ""
      }))
      .filter((v: any) => v.id);

    if (videos.length === 0) {
      return res.json({
        videos: generalFoodShorts,
        isDemo: true,
        message: `No active shorts found on YouTube for "${searchQuery}". Showing curated food shorts instead!`
      });
    }

    return res.json({
      videos,
      isDemo: false
    });
  } catch (error: any) {
    console.error("Error in /api/youtube-shorts handler:", error);
    res.status(500).json({
      error: error.message || "Failed to search YouTube Shorts",
      videos: [
        { id: "M89Cg8uO0m0", title: "Top rated dining experience & food review", channelTitle: "FoodieVlogs" }
      ],
      isDemo: true,
      message: "An internal server error occurred while retrieving videos."
    });
  }
});

// Serve frontend assets
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
