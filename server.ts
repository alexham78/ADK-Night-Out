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
3. Formulate a warm, helpful, elegant conversational response (1-2 short paragraphs) summarizing the plan for the night out. Suggest how the evening could flow (e.g., drinks first, highlight of the restaurant, followed by a local dessert/walk concept, etc.).
4. Return a structured JSON response matching the required schema. Ensure every recommendation ID matches a candidate ID exactly.
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an elegant, personalized local guide planning night outs. Your response must strictly be valid JSON adhering to the response schema.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            conversationalResponse: {
              type: Type.STRING,
              description: "A warm, helpful introduction summarizing the night out, why these top choices stand out for this specific occasion/budget/flexibility, and proposing a flow for the night out (e.g. drinks, dinner, then activity)."
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
