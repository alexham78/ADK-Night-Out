import React, { useState, useEffect, useRef } from "react";
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
  useMapsLibrary,
  useAdvancedMarkerRef,
} from "@vis.gl/react-google-maps";
import {
  Search,
  MapPin,
  Compass,
  DollarSign,
  Calendar,
  ChevronRight,
  Star,
  MessageSquare,
  Map as MapIcon,
  List,
  Loader2,
  Sparkles,
  RefreshCw,
  Sliders,
  X,
  ChevronLeft,
  User,
  Check,
  ExternalLink,
  Utensils,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Get Maps API key from environment
const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";

const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isSystem?: boolean;
}

interface Preferences {
  city: string;
  occasion: string;
  foodPreference: string;
  budget: string;
  flexibility: string;
}

interface RestaurantCandidate {
  id: string;
  displayName: string;
  formattedAddress: string;
  location: { lat: number; lng: number } | null;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  websiteUri?: string;
  photoUrl?: string;
  reviews: Array<{ rating: number; text: string }>;
}

interface GeminiRecommendation {
  id: string;
  score: number;
  matchReason: string;
  reviewHighlights: string[];
}

export default function App() {
  // If no API key is provided, show the elegant splash screen (Constitution Rule 1)
  if (!hasValidKey) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center font-sans p-6 text-slate-100">
        <div className="max-w-md w-full bg-slate-900/60 backdrop-blur-xl rounded-3xl p-8 border border-slate-800 shadow-2xl text-center">
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-amber-500/20">
            <Compass className="w-8 h-8 text-amber-400 animate-pulse" />
          </div>
          <h2 className="text-3xl font-display font-semibold tracking-tight text-white mb-3">
            API Key Required
          </h2>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            Welcome to the Night Out Planner! To enable Google Maps routing, text search, and restaurant listings, you must configure your Maps API key.
          </p>

          <div className="text-left bg-slate-950/60 rounded-2xl p-5 border border-slate-800 text-xs space-y-4 mb-6">
            <p className="font-medium text-amber-400 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Setup Instructions:
            </p>
            <ol className="list-decimal list-inside space-y-2.5 text-slate-300 leading-relaxed">
              <li>
                Get a Google Maps API Key from the{" "}
                <a
                  href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 hover:underline"
                >
                  Cloud Console
                </a>
              </li>
              <li>
                Open the **Settings** (⚙️ gear icon in the **top-right corner** of AI Studio)
              </li>
              <li>
                Select **Secrets**
              </li>
              <li>
                Add a secret named <code>GOOGLE_MAPS_PLATFORM_KEY</code> and paste your key.
              </li>
            </ol>
          </div>

          <p className="text-slate-500 text-xs">
            The workspace will rebuild automatically once the key is saved.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} version="weekly">
      <NightOutPlannerCore />
    </APIProvider>
  );
}

// Inner component to safely use react-google-maps hooks inside APIProvider
function NightOutPlannerCore() {
  const placesLib = useMapsLibrary("places");
  const map = useMap();

  // Onboarding Steps State
  // Step 0: City, Step 1: Occasion, Step 2: Cuisine, Step 3: Budget, Step 4: Flexibility, Step 5: Planning Transition, Step 6: Dashboard
  const [step, setStep] = useState<number>(0);
  const [preferences, setPreferences] = useState<Preferences>({
    city: "",
    occasion: "",
    foodPreference: "",
    budget: "",
    flexibility: "",
  });

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Hi! I'm your concierge guide 🍸. Let's design the perfect night out. First, **which city are we exploring tonight?**",
    },
  ]);

  const [chatInput, setChatInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmittingChat, setIsSubmittingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search Results & Gemini Plan State
  const [candidates, setCandidates] = useState<RestaurantCandidate[]>([]);
  const [recommendations, setRecommendations] = useState<GeminiRecommendation[]>([]);
  const [conversationalResponse, setConversationalResponse] = useState<string>("");
  const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(null);

  // User custom embedded YouTube video IDs per restaurant
  const [embeddedVideos, setEmbeddedVideos] = useState<Record<string, { id: string; isShort: boolean }>>({});
  const [showVideoInputId, setShowVideoInputId] = useState<string | null>(null);
  const [videoInputText, setVideoInputText] = useState("");
  const [videoErrorId, setVideoErrorId] = useState<string | null>(null);

  // Helper to extract YouTube video ID from standard URLs or Short URLs
  const extractYoutubeId = (url: string): string | null => {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|shorts\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  // Map settings
  const [mapCenter, setMapCenter] = useState({ lat: 37.7749, lng: -122.4194 }); // default SF
  const [mapZoom, setMapZoom] = useState(12);

  // YouTube Shorts Feed States
  const [rightPanelTab, setRightPanelTab] = useState<"map" | "shorts">("map");
  const [shortsList, setShortsList] = useState<any[]>([]);
  const [currentShortIndex, setCurrentShortIndex] = useState<number>(0);
  const [slideDirection, setSlideDirection] = useState<"up" | "down">("up");
  const [isLoadingShorts, setIsLoadingShorts] = useState<boolean>(false);
  const [shortsError, setShortsError] = useState<string | null>(null);
  const [shortsMessage, setShortsMessage] = useState<string | null>(null);
  const [lastFetchedRestaurantId, setLastFetchedRestaurantId] = useState<string | null>(null);

  // Fetch Shorts / Videos for a specific restaurant
  const fetchShortsForRestaurant = async (restaurantId: string, force = false) => {
    const spot = candidates.find((c) => c.id === restaurantId);
    if (!spot) return;
    if (lastFetchedRestaurantId === restaurantId && !force && shortsList.length > 0) return;

    setIsLoadingShorts(true);
    setShortsError(null);
    setShortsMessage(null);

    try {
      const res = await fetch(
        `/api/youtube-shorts?restaurantName=${encodeURIComponent(spot.displayName)}&city=${encodeURIComponent(preferences.city || "")}`
      );
      if (!res.ok) {
        throw new Error("Failed to search YouTube Shorts");
      }
      const data = await res.json();
      if (data.videos && data.videos.length > 0) {
        setShortsList(data.videos);
        setCurrentShortIndex(0);
        if (data.isDemo) {
          setShortsMessage(data.message);
        }
      } else {
        setShortsList([]);
        setShortsError(`No video reviews found on YouTube for "${spot.displayName}".`);
      }
      setLastFetchedRestaurantId(restaurantId);
    } catch (err: any) {
      console.error(err);
      setShortsError(err.message || "Failed to load live Shorts feed.");
    } finally {
      setIsLoadingShorts(false);
    }
  };

  // Fetch general city shorts
  const fetchGeneralCityShorts = async () => {
    setIsLoadingShorts(true);
    setShortsError(null);
    setShortsMessage(null);

    try {
      const cityName = preferences.city || "restaurants";
      const res = await fetch(
        `/api/youtube-shorts?restaurantName=${encodeURIComponent(cityName + " best restaurants review")}&city=${encodeURIComponent(preferences.city || "")}`
      );
      if (!res.ok) {
        throw new Error("Failed to search YouTube Shorts");
      }
      const data = await res.json();
      if (data.videos && data.videos.length > 0) {
        setShortsList(data.videos);
        setCurrentShortIndex(0);
        if (data.isDemo) {
          setShortsMessage(data.message);
        }
      } else {
        setShortsList([]);
        setShortsError("No video results found.");
      }
      setLastFetchedRestaurantId("general");
    } catch (err: any) {
      console.error(err);
      setShortsError(err.message || "Failed to load live Shorts feed.");
    } finally {
      setIsLoadingShorts(false);
    }
  };

  // Load shorts dynamically based on active selection
  useEffect(() => {
    if (rightPanelTab === "shorts") {
      if (activeRestaurantId) {
        fetchShortsForRestaurant(activeRestaurantId);
      } else {
        fetchGeneralCityShorts();
      }
    }
  }, [activeRestaurantId, rightPanelTab]);

  // Mobile navigation tabs: 'map' (interactive map with overlay list drawer), 'chat' (refinement conversation)
  const [viewMode, setViewMode] = useState<"map" | "chat">("map");

  // Mobile slider drawer state
  const [isDrawerExpanded, setIsDrawerExpanded] = useState<boolean>(false);

  // Bottom scroll utilities for chat threads using direct element scrolling to prevent window offsets on mobile loads
  const onboardingChatContainerRef = useRef<HTMLDivElement>(null);
  const dashboardChatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // We scroll the direct scrollable containers instead of calling scrollIntoView on a child.
    // Calling scrollIntoView can cause the mobile browser window to scroll up, cutting off the header or sticky tabs.
    if (step < 6) {
      if (onboardingChatContainerRef.current) {
        onboardingChatContainerRef.current.scrollTo({
          top: onboardingChatContainerRef.current.scrollHeight,
          behavior: "smooth"
        });
      }
    } else {
      if (dashboardChatContainerRef.current) {
        dashboardChatContainerRef.current.scrollTo({
          top: dashboardChatContainerRef.current.scrollHeight,
          behavior: "smooth"
        });
      }
    }
  }, [messages, step]);

  // Suggestions for rapid onboarding
  const citySuggestions = ["San Francisco, CA", "New York, NY", "Seattle, WA", "Chicago, IL", "Austin, TX", "London, UK"];
  const occasionSuggestions = [
    { label: "Date Night 👩‍❤️‍👨", value: "Date Night" },
    { label: "Anniversary 💍", value: "Anniversary" },
    { label: "Casual Outing 🍻", value: "Casual Outing" },
    { label: "Birthday Celebration 🎂", value: "Birthday Celebration" },
    { label: "Girls Night Out 💃", value: "Girls Night Out" },
    { label: "Business Dinner 👔", value: "Business Dinner" },
  ];
  const cuisineSuggestions = [
    { label: "Italian 🍝", value: "Italian" },
    { label: "Sushi / Japanese 🍣", value: "Sushi" },
    { label: "Steakhouse 🥩", value: "Steakhouse" },
    { label: "Mexican 🌮", value: "Mexican" },
    { label: "Vegan / Vegetarian 🥗", value: "Vegetarian" },
    { label: "French Bistro 🥖", value: "French" },
    { label: "Surprise Me! ✨", value: "Surprise Me!" },
  ];
  const budgetSuggestions = [
    { label: "$ (Under $15)", value: "$" },
    { label: "$$ ($15-$30)", value: "$$" },
    { label: "$$$ ($30-$60)", value: "$$$" },
    { label: "$$$$ (Splurge/Fine Dining)", value: "$$$$" },
  ];
  const flexibilitySuggestions = [
    { label: "Strict (Stick precisely to my choices)", value: "Strict" },
    { label: "Moderate (Open to close matches)", value: "Moderate" },
    { label: "Adventurous (Suggest anything spectacular nearby!)", value: "Adventurous" },
  ];

  // Helper to append a user message and advance onboarding step
  const handleOnboardingSelection = async (value: string, displayLabel?: string) => {
    const textToSend = displayLabel || value;
    const userMsgId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const userMsg: Message = {
      id: userMsgId,
      role: "user",
      content: textToSend,
    };

    // Update specific preference
    const updatedPrefs = { ...preferences };
    let nextStep = step;
    let assistantMsg: Message | null = null;

    if (step === 0) {
      updatedPrefs.city = value;
      nextStep = 1;
      assistantMsg = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        role: "assistant",
        content: `Awesome! **${value}** is a fantastic place for dining out. 🌃 Next, what is the **occasion** for your evening?`,
      };
    } else if (step === 1) {
      updatedPrefs.occasion = value;
      nextStep = 2;
      assistantMsg = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        role: "assistant",
        content: `A **${value}** sounds like so much fun! What kind of **cuisine or food preference** do you have in mind?`,
      };
    } else if (step === 2) {
      updatedPrefs.foodPreference = value;
      nextStep = 3;
      assistantMsg = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        role: "assistant",
        content: `Got it, **${value}** food! What is your comfortable **budget** level for dinner?`,
      };
    } else if (step === 3) {
      updatedPrefs.budget = value;
      nextStep = 4;
      assistantMsg = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        role: "assistant",
        content: `Perfect. Finally, how **flexible** are you with these requirements?`,
      };
    } else if (step === 4) {
      updatedPrefs.flexibility = value;
      nextStep = 5;
      assistantMsg = {
        id: `assistant-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        role: "assistant",
        content: `Fabulous. I am compiling all your choices and searching Google Places for the best matches. I will also scan actual reviews to verify positive statements matching your occasion. Designing the night out now... 🍸✨`,
      };
    }

    const nextMessages = [...messages, userMsg];
    if (assistantMsg) {
      nextMessages.push(assistantMsg);
    }
    setMessages(nextMessages);

    setPreferences(updatedPrefs);
    setStep(nextStep);

    // If onboarding is completed, trigger the planning search
    if (nextStep === 5) {
      await handleStartPlanning(updatedPrefs);
    }
  };

  // Onboarding text-field submit
  const handleOnboardingSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const val = chatInput.trim();
    setChatInput("");
    handleOnboardingSelection(val);
  };

  // Reusable sub-renderer to render yelp-style lists matching recommendations ranked list
  const renderRankedListings = (isMobileDrawer: boolean = false) => {
    return (
      <div className="space-y-4">
        {recommendations.map((rec, index) => {
          const spot = candidates.find((c) => c.id === rec.id);
          if (!spot) return null;

          const isActive = activeRestaurantId === spot.id;

          return (
            <motion.div
              key={spot.id}
              onClick={() => {
                setActiveRestaurantId(spot.id);
                if (spot.location) {
                  setMapCenter(spot.location);
                  setMapZoom(15);
                }
                if (isMobileDrawer) {
                  setIsDrawerExpanded(false);
                }
              }}
              className={`p-4 rounded-2xl border transition-all cursor-pointer text-left relative overflow-hidden group ${
                isActive
                  ? "bg-slate-900/80 border-indigo-500/40 shadow-lg shadow-indigo-500/5 ring-1 ring-indigo-500/20"
                  : "bg-slate-900/30 border-slate-900 hover:border-slate-800 hover:bg-slate-900/40"
              }`}
            >
              {/* High-contrast Match Badge */}
              <div className="absolute top-4 right-4 flex items-center gap-1 bg-emerald-950/40 border border-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold">
                <Check className="w-3 h-3" />
                {rec.score}% Match
              </div>

              <div className="flex gap-4.5">
                {/* Photo Placeholder/Actual Thumbnail */}
                <div className="w-20 h-20 sm:w-24 sm:h-24 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex-shrink-0 flex items-center justify-center relative">
                  {spot.photoUrl ? (
                    <img
                      src={spot.photoUrl}
                      alt={spot.displayName}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  ) : (
                    <Utensils className="w-8 h-8 text-slate-700" />
                  )}
                  <div className="absolute bottom-1.5 left-1.5 w-5.5 h-5.5 bg-slate-900/80 backdrop-blur-sm rounded-md flex items-center justify-center border border-slate-800 font-mono text-xs font-bold text-indigo-400">
                    {index + 1}
                  </div>
                </div>

                {/* Restaurant Info */}
                <div className="flex-1 min-w-0 pr-16">
                  <h3 className="font-display font-bold text-base sm:text-lg text-white group-hover:text-indigo-400 transition-colors truncate">
                    {spot.displayName}
                  </h3>

                  {/* Ratings & Price */}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <div className="flex items-center text-amber-400">
                      <Star className="w-3.5 h-3.5 fill-amber-400 flex-shrink-0" />
                      <span className="text-xs font-bold ml-1">{spot.rating || "N/A"}</span>
                    </div>
                    <span className="text-[10px] text-slate-500">
                      ({spot.userRatingCount || 0} reviews)
                    </span>
                    <div className="w-1 h-1 rounded-full bg-slate-800" />
                    <span className="text-xs font-mono font-bold text-indigo-400">
                      {renderPriceLevel(spot.priceLevel)}
                    </span>
                  </div>

                  {/* Address */}
                  <p className="text-xs text-slate-400 mt-1.5 leading-normal truncate">
                    {spot.formattedAddress}
                  </p>
                </div>
              </div>

              {/* Gemini Match Reason */}
              <div className="mt-3.5 pt-3 border-t border-slate-900/60">
                <p className="text-xs text-slate-300 leading-relaxed font-sans">
                  <span className="text-indigo-400 font-semibold">Match Reason:</span> {rec.matchReason}
                </p>
              </div>

              {/* REVIEW SCANNER: Highlighted positive phrases */}
              {rec.reviewHighlights && rec.reviewHighlights.length > 0 && (
                <div className="mt-3 bg-slate-950/50 rounded-xl p-3 border border-slate-900/50 space-y-2">
                  <div className="text-[10px] uppercase font-mono tracking-wider text-amber-400/80 flex items-center gap-1 font-bold">
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    Review Insights Analyzed
                  </div>
                  <div className="space-y-1.5">
                    {rec.reviewHighlights.map((highlight, hIdx) => (
                      <p key={hIdx} className="text-[11px] text-slate-400 leading-relaxed italic flex items-start gap-1.5">
                        <span className="text-amber-500/60 font-serif text-sm leading-none">“</span>
                        <span>{highlight}</span>
                        <span className="text-amber-500/60 font-serif text-sm leading-none">”</span>
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Embedded YouTube video or Short */}
              {embeddedVideos[spot.id] && (
                <div className="mt-4 bg-slate-950/60 p-3 rounded-xl border border-slate-900/80" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-indigo-400 font-bold flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                      Live Restaurant Short
                    </span>
                    <button
                      onClick={() => {
                        const next = { ...embeddedVideos };
                        delete next[spot.id];
                        setEmbeddedVideos(next);
                      }}
                      className="text-[10px] font-mono text-rose-400 hover:text-rose-300 hover:underline"
                    >
                      Remove Video
                    </button>
                  </div>
                  <div className="flex justify-center">
                    <iframe
                      className={`w-full rounded-lg border border-slate-800 shadow-inner ${
                        embeddedVideos[spot.id].isShort ? "aspect-[9/16] max-w-[320px]" : "aspect-video"
                      }`}
                      src={`https://www.youtube.com/embed/${embeddedVideos[spot.id].id}`}
                      title="YouTube video player"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    ></iframe>
                  </div>
                </div>
              )}

              {/* Website & YouTube Links */}
              <div className="mt-4 pt-3 border-t border-slate-900/40 flex items-center justify-between flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <a
                    href={`https://www.youtube.com/results?search_query=${encodeURIComponent(spot.displayName + " " + preferences.city + " shorts")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-mono text-slate-300 hover:text-indigo-400 flex items-center gap-1.5 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-900 hover:border-indigo-500/20 transition-all font-semibold"
                  >
                    <svg className="w-3.5 h-3.5 text-rose-500 fill-current" viewBox="0 0 24 24">
                      <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.507 9.388.507 9.388.507s7.517 0 9.388-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    Search Shorts
                  </a>

                  <button
                    onClick={() => {
                      if (showVideoInputId === spot.id) {
                        setShowVideoInputId(null);
                      } else {
                        setShowVideoInputId(spot.id);
                        setVideoInputText("");
                        setVideoErrorId(null);
                      }
                    }}
                    className="text-[11px] font-mono text-slate-300 hover:text-indigo-400 flex items-center gap-1.5 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-900 hover:border-indigo-500/20 transition-all font-semibold"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    {embeddedVideos[spot.id] ? "Change Video" : "Embed Short"}
                  </button>
                </div>

                {spot.websiteUri && (
                  <a
                    href={spot.websiteUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 font-semibold"
                  >
                    Visit Website
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              {/* Inline input for pasting YouTube URL */}
              {showVideoInputId === spot.id && (
                <div className="mt-3 bg-slate-950 p-3 rounded-xl border border-indigo-500/20" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-indigo-400 font-bold">Paste YouTube Video or Shorts URL:</span>
                    <button onClick={() => setShowVideoInputId(null)} className="text-slate-500 hover:text-slate-300">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={videoInputText}
                      onChange={(e) => {
                        setVideoInputText(e.target.value);
                        setVideoErrorId(null);
                      }}
                      placeholder="https://youtube.com/shorts/... or https://youtu.be/..."
                      className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 font-sans"
                    />
                    <button
                      onClick={() => {
                        const videoId = extractYoutubeId(videoInputText);
                        if (videoId) {
                          const isShort = videoInputText.includes("shorts") || videoInputText.includes("/v/");
                          setEmbeddedVideos({
                            ...embeddedVideos,
                            [spot.id]: { id: videoId, isShort },
                          });
                          setShowVideoInputId(null);
                          setVideoInputText("");
                          setVideoErrorId(null);
                        } else {
                          setVideoErrorId(spot.id);
                        }
                      }}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs px-3 py-1.5 rounded-lg font-bold transition-colors"
                    >
                      Save
                    </button>
                  </div>
                  {videoErrorId === spot.id && (
                    <p className="text-[10px] text-rose-400 mt-1.5 font-sans">
                      Invalid URL. Please paste a standard YouTube link or Shorts link.
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    );
  };

  // Robust helper to search restaurants with support for both New (Place) and Classic (PlacesService) APIs
  const fetchRestaurants = async (query: string, placesLib: any): Promise<RestaurantCandidate[]> => {
    // 1. Try New Places API
    try {
      if (placesLib && placesLib.Place && typeof placesLib.Place.searchByText === "function") {
        console.log("Searching with Google Places API (New):", query);
        const { places } = await placesLib.Place.searchByText({
          textQuery: query,
          fields: [
            "id",
            "displayName",
            "location",
            "formattedAddress",
            "rating",
            "userRatingCount",
            "priceLevel",
            "reviews",
            "photos",
            "websiteUri",
          ],
          maxResultCount: 10,
        });

        if (places && places.length > 0) {
          return places.map((p: any) => {
            let photoUrl = "";
            if (p.photos && p.photos[0]) {
              try {
                photoUrl = p.photos[0].getURI({ maxWidth: 400 });
              } catch (e) {
                console.error("Photo URI error:", e);
              }
            }

            return {
              id: p.id,
              displayName: typeof p.displayName === "string" ? p.displayName : p.displayName?.text || p.name || "Unknown Spot",
              formattedAddress: p.formattedAddress,
              location: p.location ? { lat: p.location.lat(), lng: p.location.lng() } : null,
              rating: p.rating,
              userRatingCount: p.userRatingCount,
              priceLevel: p.priceLevel,
              websiteUri: p.websiteUri || p.websiteURI,
              photoUrl: photoUrl,
              reviews: p.reviews
                ? p.reviews.slice(0, 3).map((r: any) => ({
                    rating: r.rating || 5,
                    text: (r.text || r.originalText?.text || "").substring(0, 250),
                  }))
                : [],
            };
          });
        }
      }
    } catch (newApiError) {
      console.warn("New Places API failed or is not enabled. Falling back to Classic Places API:", newApiError);
    }

    // 2. Fall back to Classic Places API
    try {
      console.log("Searching with Google Places API (Classic):", query);
      const dummyDiv = document.createElement("div");
      const service = new placesLib.PlacesService(dummyDiv);

      const textSearchResults = await new Promise<any[]>((resolve, reject) => {
        service.textSearch({ query }, (results: any, status: any) => {
          if (status === placesLib.PlacesServiceStatus.OK && results) {
            resolve(results);
          } else if (status === placesLib.PlacesServiceStatus.ZERO_RESULTS) {
            resolve([]);
          } else {
            reject(new Error(`Classic Places search failed with status: ${status}`));
          }
        });
      });

      if (textSearchResults.length === 0) {
        return [];
      }

      // Fetch details for top 5 restaurants to scan reviews/get website
      const topResults = textSearchResults.slice(0, 5);

      const candidatesWithDetails = await Promise.all(
        topResults.map(async (result) => {
          try {
            const detailResult = await new Promise<any>((resolve) => {
              service.getDetails(
                {
                  placeId: result.place_id,
                  fields: [
                    "name",
                    "formatted_address",
                    "geometry",
                    "rating",
                    "user_ratings_total",
                    "price_level",
                    "reviews",
                    "photos",
                    "website",
                  ],
                },
                (detail: any, status: any) => {
                  if (status === placesLib.PlacesServiceStatus.OK && detail) {
                    resolve(detail);
                  } else {
                    resolve(null);
                  }
                }
              );
            });

            const finalDetail = detailResult || {};
            let photoUrl = "";
            const photoObj = finalDetail.photos?.[0] || result.photos?.[0];
            if (photoObj) {
              try {
                photoUrl = typeof photoObj.getUrl === "function" ? photoObj.getUrl({ maxWidth: 400 }) : "";
              } catch (e) {}
            }

            // Price levels mapping
            let priceLvlStr = "PRICE_LEVEL_MODERATE";
            const pLevel = finalDetail.price_level !== undefined ? finalDetail.price_level : result.price_level;
            if (pLevel === 0) priceLvlStr = "PRICE_LEVEL_FREE";
            else if (pLevel === 1) priceLvlStr = "PRICE_LEVEL_INEXPENSIVE";
            else if (pLevel === 2) priceLvlStr = "PRICE_LEVEL_MODERATE";
            else if (pLevel === 3) priceLvlStr = "PRICE_LEVEL_EXPENSIVE";
            else if (pLevel === 4) priceLvlStr = "PRICE_LEVEL_VERY_EXPENSIVE";

            return {
              id: result.place_id,
              displayName: result.name || "Unknown Spot",
              formattedAddress: result.formatted_address || "Unknown Address",
              location: result.geometry?.location
                ? { lat: result.geometry.location.lat(), lng: result.geometry.location.lng() }
                : null,
              rating: result.rating || finalDetail.rating,
              userRatingCount: result.user_ratings_total || finalDetail.user_ratings_total,
              priceLevel: priceLvlStr,
              websiteUri: finalDetail.website,
              photoUrl: photoUrl,
              reviews: finalDetail.reviews
                ? finalDetail.reviews.slice(0, 3).map((r: any) => ({
                    rating: r.rating || 5,
                    text: (r.text || "").substring(0, 250),
                  }))
                : [],
            };
          } catch (detailError) {
            console.error("Error getting details for place ID:", result.place_id, detailError);
            let photoUrl = "";
            if (result.photos && result.photos[0]) {
              try {
                photoUrl = typeof result.photos[0].getUrl === "function" ? result.photos[0].getUrl({ maxWidth: 400 }) : "";
              } catch (e) {}
            }
            return {
              id: result.place_id,
              displayName: result.name || "Unknown Spot",
              formattedAddress: result.formatted_address || "Unknown Address",
              location: result.geometry?.location
                ? { lat: result.geometry.location.lat(), lng: result.geometry.location.lng() }
                : null,
              rating: result.rating,
              userRatingCount: result.user_ratings_total,
              priceLevel: "PRICE_LEVEL_MODERATE",
              websiteUri: "",
              photoUrl: photoUrl,
              reviews: [],
            };
          }
        })
      );

      return candidatesWithDetails;
    } catch (classicApiError) {
      console.error("Classic Places API also failed:", classicApiError);
      throw new Error("Failed to search Google Places. Please make sure the Places API is enabled on your API key.");
    }
  };

  // Perform Google Place Search + Gemini Analysis
  const handleStartPlanning = async (finalPrefs: Preferences) => {
    if (!placesLib) {
      setError("Google Maps Places library is still loading. Please try again in a moment.");
      setStep(4); // Keep them at flexibility step so they can click again
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Build search query based on preferences
      const cuisineText = finalPrefs.foodPreference === "Surprise Me!" ? "best" : finalPrefs.foodPreference;
      const query = `${cuisineText} restaurants in ${finalPrefs.city}`;

      const mappedCandidates = await fetchRestaurants(query, placesLib);

      if (mappedCandidates.length === 0) {
        setError(`We couldn't find any restaurant recommendations for "${query}". Try updating your city or choice of cuisine!`);
        setStep(4); // Revert back to flexibility choice so they can try again
        setIsLoading(false);
        return;
      }

      setCandidates(mappedCandidates);

      // Call Express server with candidates + preferences + conversation history
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: finalPrefs,
          history: messages,
          candidates: mappedCandidates.slice(0, 5),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to compile the plan via Gemini.");
      }

      const data = await response.json();

      setConversationalResponse(data.conversationalResponse);
      setRecommendations(data.recommendations || []);
      setStep(6); // Render full dashboard

      // Update map center with highest scoring recommendation
      const topRec = data.recommendations?.[0];
      const matchedSpot = mappedCandidates.find((c) => c.id === topRec?.id);
      if (matchedSpot && matchedSpot.location) {
        setMapCenter(matchedSpot.location);
        setMapZoom(14);
        setActiveRestaurantId(matchedSpot.id);
      } else if (mappedCandidates[0]?.location) {
        setMapCenter(mappedCandidates[0].location);
        setMapZoom(13);
      }
    } catch (err: any) {
      console.error("Planning setup error:", err);
      const errorMessage = err.message || "Something went wrong searching and ranking. Please try again.";
      setError(errorMessage);
      
      // Conversational error response to explain clearly in the chat window
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-plan-err-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          role: "assistant",
          content: `⚠️ **Oops! I ran into an error designing your night out plan:**\n\n"${errorMessage}"\n\nPlease check your keys in **Settings > Secrets** or make sure the necessary APIs (like Google Places API) are enabled on your Google Maps Key, then select your flexibility choice again to retry!`,
        },
      ]);
      setStep(4);
    } finally {
      setIsLoading(false);
    }
  };

  // Conversational Refinement Submits (After entering Dashboard)
  const handleRefineSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isSubmittingChat) return;

    const userText = chatInput.trim();
    setChatInput("");
    setIsSubmittingChat(true);

    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      role: "user",
      content: userText,
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences,
          history: nextMessages,
          candidates: candidates.slice(0, 5),
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to recompile criteria.");
      }

      const data = await response.json();

      // Check if Gemini triggered a dynamic Places search
      if (data.newSearchQuery) {
        const sysMsg: Message = {
          id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          role: "assistant",
          content: `Let's pivot the plan! Searching Google Places for: "${data.newSearchQuery}"...`,
          isSystem: true,
        };
        setMessages((prev) => [...prev, sysMsg]);

        const mappedCandidates = await fetchRestaurants(data.newSearchQuery, placesLib);

        if (mappedCandidates.length > 0) {
          setCandidates(mappedCandidates);

          // Get recommendations on new candidates
          const secondRes = await fetch("/api/plan", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              preferences: {
                ...preferences,
                foodPreference: data.newSearchQuery,
              },
              history: [...nextMessages, sysMsg],
              candidates: mappedCandidates.slice(0, 5),
            }),
          });

          const secondData = await secondRes.json();
          setConversationalResponse(secondData.conversationalResponse);
          setRecommendations(secondData.recommendations || []);

          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-rec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              role: "assistant",
              content: secondData.conversationalResponse,
            },
          ]);

          // Zoom & Focus
          const topRec = secondData.recommendations?.[0];
          const matchedSpot = mappedCandidates.find((c) => c.id === topRec?.id);
          if (matchedSpot && matchedSpot.location) {
            setMapCenter(matchedSpot.location);
            setMapZoom(14);
            setActiveRestaurantId(matchedSpot.id);
          }
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: `assistant-fail-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
              role: "assistant",
              content: `I searched for "${data.newSearchQuery}" but didn't find any matching results. Let's keep exploring our current options!`,
            },
          ]);
        }
      } else {
        // Simple re-ranking of existing candidates
        setConversationalResponse(data.conversationalResponse);
        setRecommendations(data.recommendations || []);

        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-refine-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            role: "assistant",
            content: data.conversationalResponse,
          },
        ]);

        const topRec = data.recommendations?.[0];
        const matchedSpot = candidates.find((c) => c.id === topRec?.id);
        if (matchedSpot && matchedSpot.location) {
          setMapCenter(matchedSpot.location);
          setMapZoom(14);
          setActiveRestaurantId(matchedSpot.id);
        }
      }
    } catch (err) {
      console.error("Refinement error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `assistant-err-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          role: "assistant",
          content: "I ran into a small error trying to refine that. What else would you like to adjust?",
        },
      ]);
    } finally {
      setIsSubmittingChat(false);
    }
  };

  // Reset planner to start over
  const handleReset = () => {
    setStep(0);
    setPreferences({
      city: "",
      occasion: "",
      foodPreference: "",
      budget: "",
      flexibility: "",
    });
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "Hi! I'm your concierge guide 🍸. Let's design the perfect night out. First, **which city are we exploring tonight?**",
      },
    ]);
    setCandidates([]);
    setRecommendations([]);
    setConversationalResponse("");
    setActiveRestaurantId(null);
    setError(null);
    setViewMode("list");
  };

  // Helper to resolve price levels to $ symbols
  const renderPriceLevel = (level?: string) => {
    switch (level) {
      case "PRICE_LEVEL_FREE":
        return "Free";
      case "PRICE_LEVEL_INEXPENSIVE":
        return "$";
      case "PRICE_LEVEL_MODERATE":
        return "$$";
      case "PRICE_LEVEL_EXPENSIVE":
        return "$$$";
      case "PRICE_LEVEL_VERY_EXPENSIVE":
        return "$$$$";
      default:
        return "$$"; // fallback standard
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-indigo-500/30 selection:text-white">
      {/* HEADER */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-4 py-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={handleReset}>
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center border border-indigo-500/30">
              <Compass className="w-5.5 h-5.5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold tracking-tight text-white leading-none">
                Night Out Planner
              </h1>
              <span className="text-[10px] font-mono text-indigo-400 tracking-wider uppercase">
                AI Concierge & Maps
              </span>
            </div>
          </div>

          {step === 6 && (
            <div className="hidden md:flex items-center gap-4 bg-slate-900/50 px-4 py-1.5 rounded-full border border-slate-800 text-xs">
              <div className="flex items-center gap-1.5 text-slate-300">
                <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                <span>{preferences.city}</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-700" />
              <div className="flex items-center gap-1.5 text-slate-300">
                <Calendar className="w-3.5 h-3.5 text-indigo-400" />
                <span>{preferences.occasion}</span>
              </div>
              <div className="w-1 h-1 rounded-full bg-slate-700" />
              <div className="flex items-center gap-1.5 text-slate-300">
                <Utensils className="w-3.5 h-3.5 text-indigo-400" />
                <span>{preferences.foodPreference}</span>
              </div>
            </div>
          )}

          <div>
            <button
              onClick={handleReset}
              className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-800 hover:border-slate-700 hover:bg-slate-900/50 transition-colors flex items-center gap-1.5 text-slate-300"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Start Over
            </button>
          </div>
        </div>
      </header>

      {/* ERROR BANNER */}
      {error && (
        <div className="bg-red-950/80 border-b border-red-900/50 py-3 px-4 text-center text-xs text-red-200 backdrop-blur-sm z-40">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="underline hover:text-white font-bold ml-1.5">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* CORE WRAPPER */}
      <main className="flex-1 flex flex-col md:flex-row relative overflow-hidden">
        {step < 6 ? (
          /* ONBOARDING PANEL (Step 0 to 5) */
          <div className="flex-1 max-w-4xl w-full mx-auto p-4 sm:p-6 flex flex-col justify-between h-[calc(100dvh-68px)] lg:h-[calc(100vh-68px)]">
            {/* Chat History & Onboarding Questions */}
            <div ref={onboardingChatContainerRef} className="flex-1 overflow-y-auto space-y-5 pr-2 pt-2 scroll-smooth">
              <AnimatePresence initial={false}>
                {messages.map((msg) => {
                  if (msg.isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-2">
                        <span className="bg-indigo-950/40 border border-indigo-900/30 text-indigo-300 font-mono text-[10px] px-3 py-1 rounded-full flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-indigo-400 animate-spin" />
                          {msg.content}
                        </span>
                      </div>
                    );
                  }

                  const isAssistant = msg.role === "assistant";
                  return (
                    <motion.div
                      key={msg.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex gap-3 max-w-[85%] ${isAssistant ? "" : "ml-auto flex-row-reverse"}`}
                    >
                      {/* Avatar */}
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border ${
                          isAssistant
                            ? "bg-indigo-950/80 border-indigo-500/20 text-indigo-400"
                            : "bg-slate-800 border-slate-700 text-slate-300"
                        }`}
                      >
                        {isAssistant ? <Compass className="w-4.5 h-4.5 text-indigo-400" /> : <User className="w-4.5 h-4.5 text-slate-400" />}
                      </div>

                      {/* Message Bubble */}
                      <div
                        className={`p-4 rounded-2xl shadow-md border ${
                          isAssistant
                            ? "bg-slate-900/70 border-slate-800 text-slate-200 rounded-tl-none"
                            : "bg-indigo-600 border-indigo-500 text-white rounded-tr-none"
                        }`}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {/* Loader */}
              {isLoading && (
                <div className="flex gap-3 max-w-[80%]">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-indigo-950 border border-indigo-500/20 text-indigo-400">
                    <Loader2 className="w-4.5 h-4.5 animate-spin" />
                  </div>
                  <div className="bg-slate-900/70 border border-slate-800 text-slate-400 p-4 rounded-2xl rounded-tl-none text-sm flex items-center gap-2">
                    <span>Designing your premium night out plan...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive Selector Board */}
            {!isLoading && step < 5 && (
              <div className="bg-slate-900/40 rounded-2xl p-4 sm:p-5 border border-slate-900 mt-4">
                <div className="text-xs text-slate-400 mb-3 font-medium uppercase tracking-wider flex items-center gap-1.5">
                  <Sliders className="w-3.5 h-3.5 text-indigo-400" />
                  Quick Selection
                </div>

                <AnimatePresence mode="wait">
                  {step === 0 && (
                    <motion.div
                      key="step0"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                    >
                      {citySuggestions.map((city) => (
                        <button
                          key={city}
                          onClick={() => handleOnboardingSelection(city)}
                          className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-indigo-500 hover:bg-slate-800/80 text-left text-xs sm:text-sm font-medium text-slate-200 transition-all flex items-center justify-between"
                        >
                          <span>{city}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {step === 1 && (
                    <motion.div
                      key="step1"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                    >
                      {occasionSuggestions.map((occ) => (
                        <button
                          key={occ.value}
                          onClick={() => handleOnboardingSelection(occ.value, occ.label)}
                          className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-indigo-500 hover:bg-slate-800/80 text-left text-xs sm:text-sm font-medium text-slate-200 transition-all flex items-center justify-between"
                        >
                          <span>{occ.label}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {step === 2 && (
                    <motion.div
                      key="step2"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                    >
                      {cuisineSuggestions.map((cuis) => (
                        <button
                          key={cuis.value}
                          onClick={() => handleOnboardingSelection(cuis.value, cuis.label)}
                          className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-indigo-500 hover:bg-slate-800/80 text-left text-xs sm:text-sm font-medium text-slate-200 transition-all flex items-center justify-between"
                        >
                          <span>{cuis.label}</span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {step === 3 && (
                    <motion.div
                      key="step3"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-2 gap-2"
                    >
                      {budgetSuggestions.map((bud) => (
                        <button
                          key={bud.value}
                          onClick={() => handleOnboardingSelection(bud.value, bud.label)}
                          className="px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl hover:border-indigo-500 hover:bg-slate-800/80 text-left text-xs sm:text-sm font-medium text-slate-200 transition-all flex items-center justify-between"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-amber-400 font-bold font-mono">{bud.value}</span>
                            <span className="text-slate-400 text-xs font-normal">({bud.label.split("(")[1]}</span>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                        </button>
                      ))}
                    </motion.div>
                  )}

                  {step === 4 && (
                    <motion.div
                      key="step4"
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-2"
                    >
                      {flexibilitySuggestions.map((flex) => (
                        <button
                          key={flex.value}
                          onClick={() => handleOnboardingSelection(flex.value, flex.label)}
                          className="px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl hover:border-indigo-500 hover:bg-slate-800/80 text-left text-xs sm:text-sm font-medium text-slate-200 transition-all flex flex-col gap-1"
                        >
                          <div className="font-semibold text-slate-100 flex items-center justify-between w-full">
                            <span>{flex.value}</span>
                            <Check className="w-3.5 h-3.5 text-indigo-400 opacity-60" />
                          </div>
                          <span className="text-[10px] text-slate-400 leading-normal">
                            {flex.label.split("(")[1]?.replace(")", "") || ""}
                          </span>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Text input fallback for conversational entry */}
                <form onSubmit={handleOnboardingSubmit} className="mt-4 pt-4 border-t border-slate-900 flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder={
                      step === 0
                        ? "Or type any city (e.g., Paris, Boston)..."
                        : "Or type a custom response..."
                    }
                    className="flex-1 bg-slate-950/70 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                  />
                  <button
                    type="submit"
                    className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-sm transition-colors flex items-center gap-1.5"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>
        ) : (
          /* MAIN DASHBOARD SCREEN (Step 6) */
          <div className="flex-1 flex flex-col lg:flex-row h-[calc(100dvh-68px)] lg:h-[calc(100vh-68px)] overflow-hidden">
            
            {/* MOBILE TOGGLE TABS (Only visible on mobile/tablet) */}
            <div className="lg:hidden flex border-b border-slate-900 bg-slate-950/80 backdrop-blur-md z-10 sticky top-0">
              <button
                onClick={() => {
                  setViewMode("map");
                  setRightPanelTab("map");
                }}
                className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-all ${
                  viewMode === "map" && rightPanelTab === "map"
                    ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                <MapIcon className="w-4 h-4" />
                Map View
              </button>
              <button
                onClick={() => {
                  setViewMode("map");
                  setRightPanelTab("shorts");
                }}
                className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-all ${
                  viewMode === "map" && rightPanelTab === "shorts"
                    ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                  <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.507 9.388.507 9.388.507s7.517 0 9.388-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                </svg>
                Video Feed
              </button>
              <button
                onClick={() => setViewMode("chat")}
                className={`flex-1 py-3 text-xs font-semibold uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-all relative ${
                  viewMode === "chat"
                    ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
                    : "border-transparent text-slate-400 hover:text-slate-300"
                }`}
              >
                <MessageSquare className="w-4 h-4" />
                AI Concierge
                {isSubmittingChat && (
                  <span className="absolute top-2.5 right-6 w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
                )}
              </button>
            </div>

            {/* LEFT COLUMN: Yelp-style Recommendations & Review Scanner */}
            <div
              className="hidden lg:flex flex-col border-r border-slate-900 bg-slate-950 lg:max-w-2xl xl:max-w-3xl h-full overflow-hidden"
            >
              {/* Summary / Flow banner from Gemini */}
              <div className="bg-slate-900/40 p-3 border-b border-slate-900">
                <div className="flex items-start gap-2.5 bg-indigo-950/20 rounded-xl p-3 border border-indigo-500/10">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400 mt-0.5">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-display font-semibold uppercase tracking-wider text-indigo-400 mb-0.5">
                      Concierge Plan Draft
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {conversationalResponse || "Generating re-ranking insights..."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Yelp-style Ranked Listings */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono tracking-wider uppercase">
                  <span>Matched Recommendations</span>
                  <span>{candidates.length} Spots Located</span>
                </div>

                {renderRankedListings(false)}
              </div>
            </div>

            {/* OLD COPIED CONTAINER WRAPPED AND HIDDEN FOR STABILITY */}
            <div className="hidden">
            <div
              className={`flex-1 flex flex-col border-r border-slate-900 bg-slate-950 lg:max-w-2xl xl:max-w-3xl h-full overflow-hidden ${
                viewMode === "list" ? "block" : "hidden lg:flex"
              }`}
            >
              {/* Summary / Flow banner from Gemini */}
              <div className="bg-slate-900/40 p-3 border-b border-slate-900">
                <div className="flex items-start gap-2.5 bg-indigo-950/20 rounded-xl p-3 border border-indigo-500/10">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400 mt-0.5">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-[10px] font-display font-semibold uppercase tracking-wider text-indigo-400 mb-0.5">
                      Concierge Plan Draft
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {conversationalResponse || "Generating re-ranking insights..."}
                    </p>
                  </div>
                </div>
              </div>

              {/* Yelp-style Ranked Listings */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono tracking-wider uppercase">
                  <span>Matched Recommendations</span>
                  <span>{candidates.length} Spots Located</span>
                </div>

                <div className="space-y-4">
                  {recommendations.map((rec, index) => {
                    const spot = candidates.find((c) => c.id === rec.id);
                    if (!spot) return null;

                    const isActive = activeRestaurantId === spot.id;

                    return (
                      <motion.div
                        key={spot.id}
                        onClick={() => {
                          setActiveRestaurantId(spot.id);
                          if (spot.location) {
                            setMapCenter(spot.location);
                            setMapZoom(15);
                          }
                        }}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer text-left relative overflow-hidden group ${
                          isActive
                            ? "bg-slate-900/80 border-indigo-500/40 shadow-lg shadow-indigo-500/5 ring-1 ring-indigo-500/20"
                            : "bg-slate-900/30 border-slate-900 hover:border-slate-800 hover:bg-slate-900/40"
                        }`}
                      >
                        {/* High-contrast Match Badge */}
                        <div className="absolute top-4 right-4 flex items-center gap-1 bg-emerald-950/40 border border-emerald-900/30 text-emerald-400 px-2 py-0.5 rounded-full font-mono text-[10px] font-bold">
                          <Check className="w-3 h-3" />
                          {rec.score}% Match
                        </div>

                        <div className="flex gap-4.5">
                          {/* Photo Placeholder/Actual Thumbnail */}
                          <div className="w-20 h-20 sm:w-24 sm:h-24 bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex-shrink-0 flex items-center justify-center relative">
                            {spot.photoUrl ? (
                              <img
                                src={spot.photoUrl}
                                alt={spot.displayName}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                              />
                            ) : (
                              <Utensils className="w-8 h-8 text-slate-700" />
                            )}
                            <div className="absolute bottom-1.5 left-1.5 w-5.5 h-5.5 bg-slate-900/80 backdrop-blur-sm rounded-md flex items-center justify-center border border-slate-800 font-mono text-xs font-bold text-indigo-400">
                              {index + 1}
                            </div>
                          </div>

                          {/* Restaurant Info */}
                          <div className="flex-1 min-w-0 pr-16">
                            <h3 className="font-display font-bold text-base sm:text-lg text-white group-hover:text-indigo-400 transition-colors truncate">
                              {spot.displayName}
                            </h3>

                            {/* Ratings & Price */}
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              <div className="flex items-center text-amber-400">
                                <Star className="w-3.5 h-3.5 fill-amber-400 flex-shrink-0" />
                                <span className="text-xs font-bold ml-1">{spot.rating || "N/A"}</span>
                              </div>
                              <span className="text-[10px] text-slate-500">
                                ({spot.userRatingCount || 0} reviews)
                              </span>
                              <div className="w-1 h-1 rounded-full bg-slate-800" />
                              <span className="text-xs font-mono font-bold text-indigo-400">
                                {renderPriceLevel(spot.priceLevel)}
                              </span>
                            </div>

                            {/* Address & website */}
                            <p className="text-xs text-slate-400 mt-1.5 leading-normal truncate">
                              {spot.formattedAddress}
                            </p>
                          </div>
                        </div>

                        {/* Gemini Match Reason */}
                        <div className="mt-3.5 pt-3 border-t border-slate-900/60">
                          <p className="text-xs text-slate-300 leading-relaxed font-sans">
                            <span className="text-indigo-400 font-semibold">Match Reason:</span> {rec.matchReason}
                          </p>
                        </div>

                        {/* REVIEW SCANNER: Highlighted positive phrases */}
                        {rec.reviewHighlights && rec.reviewHighlights.length > 0 && (
                          <div className="mt-3 bg-slate-950/50 rounded-xl p-3 border border-slate-900/50 space-y-2">
                            <div className="text-[10px] uppercase font-mono tracking-wider text-amber-400/80 flex items-center gap-1 font-bold">
                              <Sparkles className="w-3 h-3 text-amber-400" />
                              Review Insights Analyzed
                            </div>
                            <div className="space-y-1.5">
                              {rec.reviewHighlights.map((highlight, hIdx) => (
                                <p key={hIdx} className="text-[11px] text-slate-400 leading-relaxed italic flex items-start gap-1.5">
                                  <span className="text-amber-500/60 font-serif text-sm leading-none">“</span>
                                  <span>{highlight}</span>
                                  <span className="text-amber-500/60 font-serif text-sm leading-none">”</span>
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Embedded YouTube video or Short */}
                        {embeddedVideos[spot.id] && (
                          <div className="mt-4 bg-slate-950/60 p-3 rounded-xl border border-slate-900/80" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-[10px] uppercase font-mono tracking-wider text-indigo-400 font-bold flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                                Live Restaurant Short
                              </span>
                              <button
                                onClick={() => {
                                  const next = { ...embeddedVideos };
                                  delete next[spot.id];
                                  setEmbeddedVideos(next);
                                }}
                                className="text-[10px] font-mono text-rose-400 hover:text-rose-300 hover:underline"
                              >
                                Remove Video
                              </button>
                            </div>
                            <div className="flex justify-center">
                              <iframe
                                className={`w-full rounded-lg border border-slate-800 shadow-inner ${
                                  embeddedVideos[spot.id].isShort ? "aspect-[9/16] max-w-[240px]" : "aspect-video"
                                }`}
                                src={`https://www.youtube.com/embed/${embeddedVideos[spot.id].id}`}
                                title="YouTube video player"
                                frameBorder="0"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                allowFullScreen
                              ></iframe>
                            </div>
                          </div>
                        )}

                        {/* Website & YouTube Links */}
                        <div className="mt-4 pt-3 border-t border-slate-900/40 flex items-center justify-between flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-2">
                            {/* Search YouTube Shorts Button */}
                            <a
                              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(spot.displayName + " " + preferences.city + " shorts")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-mono text-slate-300 hover:text-indigo-400 flex items-center gap-1.5 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-900 hover:border-indigo-500/20 transition-all font-semibold"
                            >
                              <svg className="w-3.5 h-3.5 text-rose-500 fill-current" viewBox="0 0 24 24">
                                <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.507 9.388.507 9.388.507s7.517 0 9.388-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                              </svg>
                              Search Shorts
                            </a>

                            {/* Embed Video Button */}
                            <button
                              onClick={() => {
                                if (showVideoInputId === spot.id) {
                                  setShowVideoInputId(null);
                                } else {
                                  setShowVideoInputId(spot.id);
                                  setVideoInputText("");
                                  setVideoErrorId(null);
                                }
                              }}
                              className="text-[11px] font-mono text-slate-300 hover:text-indigo-400 flex items-center gap-1.5 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-900 hover:border-indigo-500/20 transition-all font-semibold"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                              {embeddedVideos[spot.id] ? "Change Video" : "Embed Short"}
                            </button>
                          </div>

                          {spot.websiteUri && (
                            <a
                              href={spot.websiteUri}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] font-mono text-indigo-400 hover:text-indigo-300 hover:underline flex items-center gap-1 font-semibold"
                            >
                              Visit Website
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>

                        {/* Inline input for pasting YouTube URL */}
                        {showVideoInputId === spot.id && (
                          <div className="mt-3 bg-slate-950 p-3 rounded-xl border border-indigo-500/20" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-mono text-indigo-400 font-bold">Paste YouTube Video or Shorts URL:</span>
                              <button onClick={() => setShowVideoInputId(null)} className="text-slate-500 hover:text-slate-300">
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={videoInputText}
                                onChange={(e) => {
                                  setVideoInputText(e.target.value);
                                  setVideoErrorId(null);
                                }}
                                placeholder="https://youtube.com/shorts/... or https://youtu.be/..."
                                className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50 font-sans"
                              />
                              <button
                                onClick={() => {
                                  const videoId = extractYoutubeId(videoInputText);
                                  if (videoId) {
                                    const isShort = videoInputText.includes("shorts") || videoInputText.includes("/v/");
                                    setEmbeddedVideos({
                                      ...embeddedVideos,
                                      [spot.id]: { id: videoId, isShort },
                                    });
                                    setShowVideoInputId(null);
                                    setVideoInputText("");
                                    setVideoErrorId(null);
                                  } else {
                                    setVideoErrorId(spot.id);
                                  }
                                }}
                                className="bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs px-3 py-1.5 rounded-lg font-bold transition-colors"
                              >
                                Save
                              </button>
                            </div>
                            {videoErrorId === spot.id && (
                              <p className="text-[10px] text-rose-400 mt-1.5 font-sans">
                                Invalid URL. Please paste a standard YouTube link or Shorts link.
                              </p>
                            )}
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </div>
            </div>

            {/* MIDDLE COLUMN: Interactive Google Map / Live YouTube Shorts Feed */}
            <div
              className={`flex-1 h-full flex flex-col relative border-r border-slate-900 bg-slate-950 overflow-hidden ${
                viewMode === "map" ? "flex" : "hidden lg:flex"
              }`}
            >
              {/* DESKTOP/MOBILE SEGMENTED TABS HEADER */}
              <div className="hidden lg:flex flex-shrink-0 bg-slate-950 border-b border-slate-900/85 px-4 py-3 items-center justify-between z-25">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
                    Interactive Workspace
                  </span>
                </div>
                <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl items-center gap-1">
                  <button
                    onClick={() => setRightPanelTab("map")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg font-mono transition-all flex items-center gap-1.5 ${
                      rightPanelTab === "map"
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-500/20 font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    Interactive Map
                  </button>
                  <button
                    onClick={() => setRightPanelTab("shorts")}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg font-mono transition-all flex items-center gap-1.5 relative ${
                      rightPanelTab === "shorts"
                        ? "bg-rose-600 text-white shadow-md shadow-rose-500/20 font-bold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                      <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.517 0-9.388.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.507 9.388.507 9.388.507s7.517 0 9.388-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                    </svg>
                    Live Shorts
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-4 ring-slate-950 animate-pulse" />
                  </button>
                </div>
              </div>

              {/* RENDER CONTENT WRAPPER */}
              <div className="flex-1 w-full relative overflow-hidden flex flex-col">
              {rightPanelTab === "map" ? (
                <>
                  {/* Map Overlay to display list count */}
                  <div className="absolute top-4 left-4 z-10 bg-slate-950/80 backdrop-blur-md border border-slate-800 rounded-xl px-4 py-2.5 shadow-xl flex items-center gap-2.5 text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                    <span className="font-medium text-slate-200">
                      {preferences.city}: Showing {candidates.length} ranked restaurants
                    </span>
                  </div>

                  {/* MOBILE SLIDE-UP DRAWER (Overlayed on map on mobile/tablet) */}
                  <div className="lg:hidden">
                    {/* Backdrop when drawer is fully expanded */}
                    {isDrawerExpanded && (
                      <div
                        className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm z-35 transition-opacity"
                        onClick={() => setIsDrawerExpanded(false)}
                      />
                    )}

                    {/* Drawer container */}
                    <div
                      className={`fixed bottom-0 left-0 right-0 z-40 bg-slate-950 border-t border-slate-900 rounded-t-[32px] transition-all duration-300 shadow-[0_-10px_30px_rgba(0,0,0,0.5)] flex flex-col ${
                        isDrawerExpanded ? "h-[85vh]" : "h-[45vh]"
                      }`}
                    >
                      {/* Swipe Handle */}
                      <div
                        className="w-full py-4 flex flex-col items-center justify-center cursor-pointer select-none border-b border-slate-900/60 bg-slate-950/60 rounded-t-[32px]"
                        onClick={() => setIsDrawerExpanded(!isDrawerExpanded)}
                      >
                        <div className="w-12 h-1 bg-slate-800 rounded-full mb-2" />
                        <span className="text-[10px] font-mono uppercase tracking-wider text-indigo-400 font-bold flex items-center gap-1.5 animate-pulse">
                          <List className="w-3.5 h-3.5" />
                          {isDrawerExpanded ? "Swipe Down to Collapse" : `Swipe Up to Expand List (${candidates.length} Matches)`}
                        </span>
                      </div>

                      {/* Content of the drawer */}
                      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
                        {renderRankedListings(true)}
                      </div>
                    </div>
                  </div>

                  {/* Map Box */}
                  <div className="w-full h-full min-h-[300px]">
                    <Map
                      center={mapCenter}
                      zoom={mapZoom}
                      mapId="DEMO_MAP_ID"
                      onCenterChanged={(e) => setMapCenter(e.detail.center)}
                      onZoomChanged={(e) => setMapZoom(e.detail.zoom)}
                      internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
                      style={{ width: "100%", height: "100%" }}
                      gestureHandling="cooperative"
                    >
                      {/* Render Candidates on Map */}
                      {candidates.map((spot, index) => {
                        if (!spot.location) return null;

                        const isSelected = activeRestaurantId === spot.id;
                        const matchingRec = recommendations.find((r) => r.id === spot.id);
                        const rankNum = index + 1;

                        return (
                          <AdvancedMarker
                            key={spot.id}
                            position={spot.location}
                            onClick={() => {
                              setActiveRestaurantId(spot.id);
                              setMapCenter(spot.location!);
                              setMapZoom(15);
                            }}
                          >
                            <Pin
                              background={isSelected ? "#ec4899" : "#6366f1"}
                              borderColor={isSelected ? "#be185d" : "#4f46e5"}
                              glyphColor="#fff"
                              glyphText={matchingRec ? `${rankNum}` : ""}
                            />
                          </AdvancedMarker>
                        );
                      })}

                      {/* Info Window for selected restaurant */}
                      {activeRestaurantId && (
                        (() => {
                          const selectedSpot = candidates.find((c) => c.id === activeRestaurantId);
                          const matchingRec = recommendations.find((r) => r.id === activeRestaurantId);
                          if (!selectedSpot || !selectedSpot.location) return null;

                          return (
                            <InfoWindow
                              position={selectedSpot.location}
                              onCloseClick={() => setActiveRestaurantId(null)}
                            >
                              <div className="text-slate-900 max-w-[240px] p-1 font-sans">
                                <h4 className="font-bold text-sm leading-tight text-slate-900">
                                  {selectedSpot.displayName}
                                </h4>
                                <div className="flex items-center gap-1.5 mt-1 text-xs">
                                  <span className="flex items-center text-amber-500 font-bold">
                                    ★ {selectedSpot.rating || "N/A"}
                                  </span>
                                  <span className="text-slate-500">
                                    ({selectedSpot.userRatingCount || 0})
                                  </span>
                                  <span className="text-indigo-600 font-mono font-bold">
                                    {renderPriceLevel(selectedSpot.priceLevel)}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-600 mt-1 leading-normal">
                                  {selectedSpot.formattedAddress}
                                </p>
                                {matchingRec && (
                                  <div className="mt-2 pt-1.5 border-t border-slate-100">
                                    <p className="text-[11px] leading-relaxed text-slate-700 italic">
                                      <strong className="text-indigo-600 font-mono">{matchingRec.score}% Match:</strong>{" "}
                                      {matchingRec.matchReason.slice(0, 80)}...
                                    </p>
                                  </div>
                                )}
                              </div>
                            </InfoWindow>
                          );
                        })()
                      )}
                    </Map>
                  </div>
                </>
              ) : (
                /* RENDER TAB 2: Live YouTube Shorts Feed (TikTok Style Swipe-Up Layout) */
                <div className="w-full h-full flex flex-col bg-slate-950 p-1 sm:p-2 relative overflow-hidden select-none">
                  
                  {/* Immersive Swipe Player Container */}
                  <div className="flex-1 flex items-center justify-center relative min-h-[350px]">
                    
                    {isLoadingShorts ? (
                      <div className="flex flex-col items-center gap-3 text-center p-8 bg-slate-900/30 border border-slate-900 rounded-3xl max-w-sm">
                        <Loader2 className="w-10 h-10 text-rose-500 animate-spin" />
                        <h4 className="font-display font-semibold text-sm text-slate-200">Searching YouTube API...</h4>
                        <p className="text-xs text-slate-400 leading-normal">
                          Fetching real-time Shorts and culinary footage for this restaurant recommendation...
                        </p>
                      </div>
                    ) : shortsError ? (
                      <div className="flex flex-col items-center gap-4 text-center p-8 bg-slate-900/40 border border-rose-500/10 rounded-3xl max-w-sm">
                        <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                          <Utensils className="w-6 h-6" />
                        </div>
                        <div>
                          <h4 className="font-display font-semibold text-sm text-slate-200">Feed Offline</h4>
                          <p className="text-xs text-slate-400 leading-relaxed mt-1.5 px-2">
                            {shortsError}
                          </p>
                        </div>
                        <button
                          onClick={() => activeRestaurantId ? fetchShortsForRestaurant(activeRestaurantId, true) : fetchGeneralCityShorts()}
                          className="px-4 py-2 bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-200 rounded-xl hover:border-indigo-500 transition-colors"
                        >
                          Retry Search
                        </button>
                      </div>
                    ) : shortsList.length > 0 ? (
                      (() => {
                        const video = shortsList[currentShortIndex];
                        const activeRec = recommendations.find((r) => r.id === activeRestaurantId);

                        // Define vertical slide animation variants
                        const slideVariants = {
                          enter: (dir: "up" | "down") => ({
                            y: dir === "up" ? "100%" : "-100%",
                            opacity: 0,
                            scale: 0.96,
                          }),
                          center: {
                            y: 0,
                            opacity: 1,
                            scale: 1,
                          },
                          exit: (dir: "up" | "down") => ({
                            y: dir === "up" ? "-100%" : "100%",
                            opacity: 0,
                            scale: 0.96,
                          }),
                        };

                        // Trigger next video cycle
                        const handleNext = () => {
                          if (currentShortIndex < shortsList.length - 1) {
                            setSlideDirection("up");
                            setCurrentShortIndex(currentShortIndex + 1);
                          }
                        };

                        // Trigger previous video cycle
                        const handlePrev = () => {
                          if (currentShortIndex > 0) {
                            setSlideDirection("down");
                            setCurrentShortIndex(currentShortIndex - 1);
                          }
                        };

                        return (
                          <div className="relative w-full h-full max-h-[88vh] flex items-center justify-center p-1 sm:p-2 select-none touch-none">
                            
                            {/* Outer simulated smartphone container (STATIONARY - Never moves) */}
                            <div className="relative aspect-[9/16] h-full max-h-[86vh] w-auto max-w-full bg-black rounded-3xl border border-slate-900/60 shadow-2xl shadow-rose-950/10 overflow-hidden flex items-center justify-center touch-none">
                              
                              {/* Slidable Video Feed (TikTok Transition feel) */}
                              <AnimatePresence initial={false} custom={slideDirection} mode="popLayout">
                                <motion.div
                                  key={video.id}
                                  custom={slideDirection}
                                  variants={slideVariants}
                                  initial="enter"
                                  animate="center"
                                  exit="exit"
                                  transition={{
                                    y: { type: "spring", stiffness: 280, damping: 28 },
                                    opacity: { duration: 0.15 },
                                    scale: { duration: 0.15 }
                                  }}
                                  drag="y"
                                  dragConstraints={{ top: 0, bottom: 0 }}
                                  dragElastic={0.4}
                                  onDragEnd={(e, info) => {
                                    if (info.offset.y < -60) {
                                      handleNext();
                                    } else if (info.offset.y > 60) {
                                      handlePrev();
                                    }
                                  }}
                                  className="absolute inset-0 w-full h-full flex items-center justify-center bg-black overflow-hidden select-none touch-none"
                                >
                                  {/* YouTube iframe player */}
                                  <iframe
                                    className="w-full h-full object-cover pointer-events-none"
                                    src={`https://www.youtube.com/embed/${video.id}?autoplay=1&mute=1&loop=1&playlist=${video.id}&controls=0&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3`}
                                    title={video.title}
                                    frameBorder="0"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                    allowFullScreen
                                  ></iframe>

                                  {/* Transparent Swipe Capture Shield */}
                                  <div className="absolute inset-0 z-10 cursor-grab active:cursor-grabbing bg-transparent touch-none" />
                                </motion.div>
                              </AnimatePresence>

                              {/* Subtle floating overlay match percentage badge if available (Stationary) */}
                              {activeRestaurantId && activeRec && (
                                <div className="absolute top-4 left-4 z-20 inline-flex items-center gap-1.5 bg-rose-600/90 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-bold text-white uppercase tracking-wider shadow-lg pointer-events-none">
                                  <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                                  {activeRec.score}% Match
                                </div>
                              )}

                              {/* Drag/Swipe instructions overlay (Stationary, Only displays on index 0 briefly) */}
                              {currentShortIndex === 0 && (
                                <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 flex items-center gap-1.5 text-[9px] font-mono font-semibold text-slate-300 animate-bounce pointer-events-none">
                                  <ChevronUp className="w-3 h-3 text-rose-500 animate-pulse" />
                                  Swipe Up / Down to Navigate
                                </div>
                              )}

                              {/* ULTRA SLEEK ULTRA COMPACT FLOATING NAVIGATION CONTROL PILL (Stationary) */}
                              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex bg-slate-950/90 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full shadow-2xl items-center gap-3">
                                <button
                                  onClick={handlePrev}
                                  disabled={currentShortIndex === 0}
                                  className="text-slate-400 hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700 transition-colors cursor-pointer disabled:cursor-default"
                                  title="Previous Video"
                                >
                                  <ChevronLeft className="w-4 h-4" />
                                </button>
                                <span className="font-mono text-[10px] text-slate-300 font-bold select-none whitespace-nowrap">
                                  {currentShortIndex + 1} / {shortsList.length}
                                </span>
                                <button
                                  onClick={handleNext}
                                  disabled={currentShortIndex === shortsList.length - 1}
                                  className="text-slate-400 hover:text-white disabled:text-slate-700 disabled:hover:text-slate-700 transition-colors cursor-pointer disabled:cursor-default"
                                  title="Next Video"
                                >
                                  <ChevronRight className="w-4 h-4" />
                                </button>
                                <span className="w-px h-3 bg-white/10" />
                                <a
                                  href={`https://www.youtube.com/watch?v=${video.id}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                                  title="Watch on YouTube"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              </div>

                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="text-center py-10">No videos loaded.</div>
                    )}

                  </div>

                  {/* Bottom Alerts & Mode status (Informs user about Secrets setup) */}
                  {shortsMessage && (
                    <div className="absolute bottom-4 left-4 right-4 z-15 bg-slate-900/90 backdrop-blur-md border border-slate-800 rounded-xl p-2.5 shadow-xl flex items-center gap-2 text-[10px]">
                      <Sparkles className="w-3.5 h-3.5 text-rose-400 flex-shrink-0 animate-pulse" />
                      <p className="text-slate-300 leading-tight">
                        {shortsMessage}
                      </p>
                    </div>
                  )}

                </div>
              )}
              </div>
            </div>

            {/* RIGHT COLUMN: AI Concierge Chat Sidebar (Always Visible on Large Screens, Tab on Mobile) */}
            <div
              className={`flex-1 lg:max-w-xs xl:max-w-sm h-full flex flex-col bg-slate-950 border-l border-slate-900 ${
                viewMode === "chat" ? "block" : "hidden lg:flex"
              }`}
            >
              <div className="p-4 border-b border-slate-900 bg-slate-900/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-indigo-400" />
                  <h3 className="font-display font-semibold text-xs uppercase tracking-wider text-slate-200">
                    Refinement Desk
                  </h3>
                </div>
                <div className="text-[10px] font-mono text-emerald-400 px-2 py-0.5 rounded-full bg-emerald-950/40 border border-emerald-900/30">
                  Active
                </div>
              </div>

              {/* Chat Thread */}
              <div ref={dashboardChatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map((msg) => {
                  if (msg.isSystem) {
                    return (
                      <div key={msg.id} className="flex justify-center my-1">
                        <span className="bg-indigo-950/30 border border-indigo-900/20 text-indigo-300 font-mono text-[9px] px-2.5 py-0.5 rounded-full flex items-center gap-1.5">
                          <Sparkles className="w-2.5 h-2.5 text-indigo-400 animate-spin" />
                          {msg.content}
                        </span>
                      </div>
                    );
                  }

                  const isAssistant = msg.role === "assistant";
                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-2.5 max-w-[90%] ${isAssistant ? "" : "ml-auto flex-row-reverse"}`}
                    >
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 border text-xs ${
                          isAssistant
                            ? "bg-indigo-950/80 border-indigo-500/20 text-indigo-400"
                            : "bg-slate-800 border-slate-700 text-slate-300"
                        }`}
                      >
                        {isAssistant ? <Compass className="w-3.5 h-3.5" /> : <User className="w-3.5 h-3.5" />}
                      </div>

                      <div
                        className={`p-3 rounded-xl text-xs border leading-relaxed ${
                          isAssistant
                            ? "bg-slate-900/60 border-slate-800/80 text-slate-300 rounded-tl-none"
                            : "bg-indigo-600 border-indigo-500 text-white rounded-tr-none"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  );
                })}

                {isSubmittingChat && (
                  <div className="flex gap-2.5 max-w-[85%]">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-950 border border-indigo-500/20 text-indigo-400">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    </div>
                    <div className="bg-slate-900/40 border border-slate-800/60 text-slate-400 p-3 rounded-xl rounded-tl-none text-[11px] flex items-center gap-1.5">
                      <span>Refining itinerary details...</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Chat Input Bar */}
              <form onSubmit={handleRefineSubmit} className="p-3 border-t border-slate-900 bg-slate-950/40">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    disabled={isSubmittingChat}
                    placeholder="E.g. 'Show me French instead', 'Outdoor seating'..."
                    className="flex-1 bg-slate-900/60 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={isSubmittingChat}
                    className="px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium text-xs transition-colors disabled:opacity-50 flex items-center justify-center"
                  >
                    Send
                  </button>
                </div>
                <p className="text-[9px] text-slate-500 mt-2 text-center">
                  Chat prompts re-analyze actual reviews dynamically to adjust recommendations.
                </p>
              </form>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}
