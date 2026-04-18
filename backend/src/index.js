const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { GoogleGenAI, Type } = require("@google/genai");
const { randomUUID } = require("node:crypto");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || "0.0.0.0";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
const CRICKET_API_KEY =
  process.env.CRICKET_API_KEY || "da80da1a-b0d0-48ad-91a3-3d110972c5e8";
const CLIENT_ORIGINS = (
  process.env.CLIENT_ORIGIN ||
  "http://localhost:5173,http://127.0.0.1:5173"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

const SYSTEM_INSTRUCTION =
  'You are a savage IPL meme creator. Analyze the provided match data JSON. Identify the most interesting event (a wicket, a high strike rate, or a close match). Generate a witty, Gen-Z style meme caption. Return the response in a clean JSON format: { "event": "description", "caption": "meme text" }.';

const sessions = new Map();

const parseModelJson = (rawText) => {
  if (!rawText || typeof rawText !== "string") {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch (_error) {
    const firstBrace = rawText.indexOf("{");
    const lastBrace = rawText.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const jsonSlice = rawText.slice(firstBrace, lastBrace + 1);
      return JSON.parse(jsonSlice);
    }
  }

  return null;
};

const buildGeminiMatchPayload = (match) => {
  if (!match || typeof match !== "object") return null;

  return {
    id: match.id ?? "",
    name: match.name ?? "",
    matchType: match.matchType ?? "",
    status: match.status ?? "",
    venue: match.venue ?? "",
    date: match.date ?? "",
    dateTimeGMT: match.dateTimeGMT ?? "",
    teams: Array.isArray(match.teams) ? match.teams : [],
    teamInfo: Array.isArray(match.teamInfo)
      ? match.teamInfo.map((team) => ({
          name: team?.name ?? "",
          shortname: team?.shortname ?? "",
        }))
      : [],
    score: Array.isArray(match.score)
      ? match.score.map((inning) => ({
          inning: inning?.inning ?? "",
          r: inning?.r ?? 0,
          w: inning?.w ?? 0,
          o: inning?.o ?? 0,
        }))
      : [],
    seriesId: match.series_id ?? "",
    matchStarted: Boolean(match.matchStarted),
    matchEnded: Boolean(match.matchEnded),
  };
};

const normalizeMatch = (match) => {
  const payload = buildGeminiMatchPayload(match);
  if (!payload || !payload.name) return null;

  const teamA = payload.teams[0] || payload.teamInfo[0]?.name || "Team A";
  const teamB = payload.teams[1] || payload.teamInfo[1]?.name || "Team B";

  return {
    ...payload,
    teamA,
    teamB,
  };
};

const makeSessionCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

const getUniqueSessionCode = () => {
  let attempts = 0;
  while (attempts < 10) {
    const code = makeSessionCode();
    if (!sessions.has(code)) return code;
    attempts += 1;
  }
  throw new Error("Could not generate unique session code.");
};

const serializeSession = (session) => ({
  code: session.code,
  createdAt: session.createdAt,
  endedAt: session.endedAt || null,
  status: session.status,
  match: session.match,
  teams: [session.teamA, session.teamB],
  scores: {
    [session.teamA]: session.scores[session.teamA] ?? 0,
    [session.teamB]: session.scores[session.teamB] ?? 0,
  },
  participantsCount: session.participants.size,
  posts: session.posts.map((post) => ({
    id: post.id,
    participantId: post.participantId,
    participantName: post.participantName,
    team: post.team,
    event: post.event,
    caption: post.caption,
    upvotes: post.upvotes,
    downvotes: post.downvotes,
    score: post.score,
    createdAt: post.createdAt,
  })),
});

const getSessionOr404 = (code, res) => {
  const session = sessions.get(code);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return null;
  }
  return session;
};

const ensureSessionActive = (session, res) => {
  if (session.status !== "ACTIVE") {
    res.status(409).json({
      error: "Session is ended. This action is no longer allowed.",
      status: session.status,
    });
    return false;
  }
  return true;
};

const getParticipantOr400 = (session, participantId, res) => {
  if (!participantId || typeof participantId !== "string") {
    res.status(400).json({ error: "participantId is required." });
    return null;
  }

  const participant = session.participants.get(participantId);
  if (!participant) {
    res.status(400).json({ error: "Invalid participantId for this session." });
    return null;
  }

  return participant;
};

const generateMemeFromMatch = async (match, supporterTeam = "") => {
  const prompt = `Analyze this selected cricket match JSON and create one meme output:\n${JSON.stringify(match)}\n\nSupporter team context (optional): ${supporterTeam || "none"}`;

  const result = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          event: { type: Type.STRING },
          caption: { type: Type.STRING },
        },
        required: ["event", "caption"],
      },
      temperature: 1.1,
    },
  });

  const parsed = parseModelJson(result.text || "");
  if (!parsed || !parsed.event || !parsed.caption) {
    throw new Error("Model returned malformed JSON.");
  }

  return {
    event: String(parsed.event),
    caption: String(parsed.caption),
  };
};

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (CLIENT_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 200,
  }),
);
app.use(express.json({ limit: "5mb" }));
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get("/", (_req, res) => {
  res.status(200).send("MemeX backend is up");
});

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    message: "MemeX backend is running",
    geminiReady: Boolean(process.env.GEMINI_API_KEY),
    model: GEMINI_MODEL,
    sessions: sessions.size,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/admin/matches", async (_req, res) => {
  try {
    const url = `https://api.cricapi.com/v1/currentMatches?apikey=${CRICKET_API_KEY}&offset=0`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({
        error: "Cricket API request failed.",
        details: `${response.status} ${response.statusText}`,
      });
    }

    const data = await response.json();
    const matches = Array.isArray(data?.data)
      ? data.data.map(normalizeMatch).filter(Boolean)
      : [];

    return res.status(200).json({
      count: matches.length,
      data: matches,
    });
  } catch (error) {
    console.error("Failed to fetch matches:", error);
    return res.status(500).json({
      error: "Failed to fetch current matches.",
      details: error?.message || "Unknown error",
    });
  }
});

app.post("/api/admin/sessions", (req, res) => {
  try {
    const matchRaw = req.body?.selectedMatch || req.body?.match;
    const match = normalizeMatch(matchRaw);
    if (!match) {
      return res.status(400).json({
        error: "Invalid match payload. Pass selected match object as selectedMatch.",
      });
    }

    const code = getUniqueSessionCode();
    const session = {
      code,
      createdAt: new Date().toISOString(),
      endedAt: null,
      status: "ACTIVE",
      adminToken: randomUUID(),
      match,
      teamA: match.teamA,
      teamB: match.teamB,
      participants: new Map(),
      posts: [],
      scores: {
        [match.teamA]: 0,
        [match.teamB]: 0,
      },
    };

    sessions.set(code, session);

    return res.status(201).json({
      code,
      adminToken: session.adminToken,
      session: serializeSession(session),
    });
  } catch (error) {
    console.error("Failed to create session:", error);
    return res.status(500).json({
      error: "Failed to create session.",
      details: error?.message || "Unknown error",
    });
  }
});

app.get("/api/admin/sessions", (_req, res) => {
  const list = Array.from(sessions.values())
    .map(serializeSession)
    .sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });

  return res.status(200).json({
    count: list.length,
    sessions: list,
  });
});

app.get("/api/sessions/:code", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSessionOr404(code, res);
  if (!session) return;

  return res.status(200).json({
    session: serializeSession(session),
  });
});

app.post("/api/sessions/:code/join", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSessionOr404(code, res);
  if (!session) return;
  if (!ensureSessionActive(session, res)) return;

  const name = String(req.body?.name || "").trim();
  const team = String(req.body?.team || "").trim();

  if (!name) {
    return res.status(400).json({ error: "name is required." });
  }

  if (team !== session.teamA && team !== session.teamB) {
    return res.status(400).json({
      error: "Invalid team selection for this session.",
    });
  }

  const participantId = randomUUID();
  const participant = {
    id: participantId,
    name,
    team,
    joinedAt: new Date().toISOString(),
  };

  session.participants.set(participantId, participant);

  return res.status(200).json({
    participant,
    session: serializeSession(session),
  });
});

app.post("/api/sessions/:code/generate-meme", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing on the backend.",
      });
    }

    const code = String(req.params.code || "").toUpperCase();
    const session = getSessionOr404(code, res);
    if (!session) return;
    if (!ensureSessionActive(session, res)) return;

    const participant = getParticipantOr400(
      session,
      req.body?.participantId,
      res,
    );
    if (!participant) return;

    const meme = await generateMemeFromMatch(session.match, participant.team);
    return res.status(200).json(meme);
  } catch (error) {
    console.error("Failed to generate session meme:", error);
    return res.status(500).json({
      error: "Failed to generate meme.",
      details: error?.message || "Unknown error",
    });
  }
});

app.post("/api/sessions/:code/posts", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSessionOr404(code, res);
  if (!session) return;
  if (!ensureSessionActive(session, res)) return;

  const participant = getParticipantOr400(session, req.body?.participantId, res);
  if (!participant) return;

  const event = String(req.body?.event || "").trim();
  const caption = String(req.body?.caption || "").trim();
  if (!event || !caption) {
    return res.status(400).json({
      error: "event and caption are required to create a post.",
    });
  }

  const post = {
    id: randomUUID(),
    participantId: participant.id,
    participantName: participant.name,
    team: participant.team,
    event,
    caption,
    upvotes: 0,
    downvotes: 0,
    score: 0,
    votesByParticipant: {},
    createdAt: new Date().toISOString(),
  };

  session.posts.unshift(post);

  return res.status(201).json({
    post: {
      id: post.id,
      participantId: post.participantId,
      participantName: post.participantName,
      team: post.team,
      event: post.event,
      caption: post.caption,
      upvotes: post.upvotes,
      downvotes: post.downvotes,
      score: post.score,
      createdAt: post.createdAt,
    },
    session: serializeSession(session),
  });
});

app.post("/api/sessions/:code/posts/:postId/vote", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSessionOr404(code, res);
  if (!session) return;
  if (!ensureSessionActive(session, res)) return;

  const participant = getParticipantOr400(session, req.body?.participantId, res);
  if (!participant) return;

  const vote = Number(req.body?.vote);
  if (vote !== 1 && vote !== -1) {
    return res.status(400).json({
      error: "vote must be 1 (upvote) or -1 (downvote).",
    });
  }

  const post = session.posts.find((item) => item.id === req.params.postId);
  if (!post) {
    return res.status(404).json({ error: "Post not found." });
  }

  if (post.participantId === participant.id) {
    return res.status(400).json({ error: "You cannot vote on your own meme." });
  }

  const previousVote = Number(post.votesByParticipant[participant.id] || 0);
  const delta = vote - previousVote;
  if (delta === 0) {
    return res.status(200).json({
      session: serializeSession(session),
    });
  }

  post.votesByParticipant[participant.id] = vote;
  post.score += delta;

  if (previousVote === 1) post.upvotes -= 1;
  if (previousVote === -1) post.downvotes -= 1;
  if (vote === 1) post.upvotes += 1;
  if (vote === -1) post.downvotes += 1;

  session.scores[post.team] = (session.scores[post.team] || 0) + delta;

  return res.status(200).json({
    session: serializeSession(session),
  });
});

app.post("/api/admin/sessions/:code/end", (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const session = getSessionOr404(code, res);
  if (!session) return;

  const adminToken = String(req.body?.adminToken || "");
  if (!adminToken || adminToken !== session.adminToken) {
    return res.status(403).json({
      error: "Invalid adminToken. Only the admin can end this session.",
    });
  }

  if (session.status === "ENDED") {
    return res.status(200).json({
      session: serializeSession(session),
    });
  }

  session.status = "ENDED";
  session.endedAt = new Date().toISOString();

  return res.status(200).json({
    session: serializeSession(session),
  });
});

app.post("/api/generate-meme", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "GEMINI_API_KEY is missing on the backend.",
      });
    }

    const selectedMatchRaw = req.body?.selectedMatch || req.body;
    const selectedMatch = normalizeMatch(selectedMatchRaw);
    if (!selectedMatch) {
      return res.status(400).json({
        error:
          "Invalid request body. Send one selected match object as { selectedMatch: {...} }.",
      });
    }

    const meme = await generateMemeFromMatch(selectedMatch);
    return res.status(200).json(meme);
  } catch (error) {
    console.error("Failed to generate meme:", error);
    return res.status(500).json({
      error: "Failed to generate meme.",
      details: error?.message || "Unknown error",
    });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Backend running on http://${HOST}:${PORT}`);
});

server.on("error", (err) => {
  console.error("Server failed to start:", err);
});
