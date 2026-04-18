import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import html2canvas from "html2canvas";
import "./App.css";

const getModeFromHash = () =>
  window.location.hash === "#/admin" ? "admin" : "play";

function App() {
  const BACKEND_BASE_URL =
    import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:5001";

  const [mode, setMode] = useState(getModeFromHash());
  const [error, setError] = useState("");

  const [adminTokens, setAdminTokens] = useState({});

  const [matches, setMatches] = useState([]);
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [createdCode, setCreatedCode] = useState("");
  const [sessionsList, setSessionsList] = useState([]);
  const [loadingAdminSessions, setLoadingAdminSessions] = useState(false);
  const [endingSessionCode, setEndingSessionCode] = useState("");

  const [sessionCodeInput, setSessionCodeInput] = useState("");
  const [activeSession, setActiveSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(false);

  const [participantName, setParticipantName] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [participant, setParticipant] = useState(null);
  const [joining, setJoining] = useState(false);

  const [generatedMeme, setGeneratedMeme] = useState(null);
  const [generatingMeme, setGeneratingMeme] = useState(false);
  const [postingMeme, setPostingMeme] = useState(false);

  const memeRef = useRef(null);

  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) || null,
    [matches, selectedMatchId],
  );

  const teamA = activeSession?.teams?.[0] || "Team A";
  const teamB = activeSession?.teams?.[1] || "Team B";
  const isSessionEnded = activeSession?.status === "ENDED";

  const saveAdminTokens = (next) => {
    setAdminTokens(next);
    localStorage.setItem("memex_admin_tokens", JSON.stringify(next));
  };

  const refreshMatches = async () => {
    setLoadingMatches(true);
    setError("");
    try {
      const response = await axios.get(`${BACKEND_BASE_URL}/api/admin/matches`);
      const list = Array.isArray(response.data?.data) ? response.data.data : [];
      setMatches(list);
      if (list.length > 0) {
        setSelectedMatchId((prev) => prev || list[0].id);
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to fetch matches.");
    } finally {
      setLoadingMatches(false);
    }
  };

  const refreshAdminSessions = async () => {
    setLoadingAdminSessions(true);
    setError("");
    try {
      const response = await axios.get(`${BACKEND_BASE_URL}/api/admin/sessions`);
      setSessionsList(Array.isArray(response.data?.sessions) ? response.data.sessions : []);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to fetch sessions.");
    } finally {
      setLoadingAdminSessions(false);
    }
  };

  const createSession = async () => {
    if (!selectedMatch) {
      setError("Select a match first.");
      return;
    }

    setCreatingSession(true);
    setError("");
    try {
      const response = await axios.post(`${BACKEND_BASE_URL}/api/admin/sessions`, {
        selectedMatch,
      });
      const code = response.data.code;
      const token = response.data.adminToken;
      setCreatedCode(code);

      if (code && token) {
        saveAdminTokens({ ...adminTokens, [code]: token });
      }

      await refreshAdminSessions();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to create session.");
    } finally {
      setCreatingSession(false);
    }
  };

  const endSessionAsAdmin = async (code) => {
    const adminToken = adminTokens[code];
    if (!adminToken) {
      setError(`Admin token missing for ${code} in this browser.`);
      return;
    }

    setEndingSessionCode(code);
    setError("");
    try {
      await axios.post(`${BACKEND_BASE_URL}/api/admin/sessions/${code}/end`, {
        adminToken,
      });

      if (activeSession?.code === code) {
        const updated = await axios.get(`${BACKEND_BASE_URL}/api/sessions/${code}`);
        setActiveSession(updated.data.session);
      }

      await refreshAdminSessions();
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to end session.");
    } finally {
      setEndingSessionCode("");
    }
  };

  const loadSession = async (code, options = {}) => {
    const { resetLocalState = true } = options;
    const normalized = String(code || "").trim().toUpperCase();
    if (!normalized) {
      setError("Enter a valid session code.");
      return;
    }

    setLoadingSession(true);
    setError("");
    try {
      const response = await axios.get(
        `${BACKEND_BASE_URL}/api/sessions/${normalized}`,
      );
      setActiveSession(response.data.session);
      setSessionCodeInput(normalized);
      setSelectedTeam((prev) => prev || response.data.session.teams?.[0] || "");
      if (resetLocalState) {
        setParticipant(null);
        setGeneratedMeme(null);
      }
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to load session.");
    } finally {
      setLoadingSession(false);
    }
  };

  const joinSession = async () => {
    if (!activeSession) {
      setError("Load a session first.");
      return;
    }
    if (!participantName.trim()) {
      setError("Enter your name.");
      return;
    }
    if (!selectedTeam) {
      setError("Select your team.");
      return;
    }

    setJoining(true);
    setError("");
    try {
      const response = await axios.post(
        `${BACKEND_BASE_URL}/api/sessions/${activeSession.code}/join`,
        {
          name: participantName.trim(),
          team: selectedTeam,
        },
      );
      setParticipant(response.data.participant);
      setActiveSession(response.data.session);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to join session.");
    } finally {
      setJoining(false);
    }
  };

  const generateMeme = async () => {
    if (!activeSession || !participant) return;

    setGeneratingMeme(true);
    setError("");
    try {
      const response = await axios.post(
        `${BACKEND_BASE_URL}/api/sessions/${activeSession.code}/generate-meme`,
        {
          participantId: participant.id,
        },
      );
      setGeneratedMeme({
        event: response.data.event,
        caption: response.data.caption,
      });
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to generate meme.");
    } finally {
      setGeneratingMeme(false);
    }
  };

  const postMeme = async () => {
    if (!activeSession || !participant || !generatedMeme) return;

    setPostingMeme(true);
    setError("");
    try {
      const response = await axios.post(
        `${BACKEND_BASE_URL}/api/sessions/${activeSession.code}/posts`,
        {
          participantId: participant.id,
          event: generatedMeme.event,
          caption: generatedMeme.caption,
        },
      );
      setActiveSession(response.data.session);
      setGeneratedMeme(null);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to post meme.");
    } finally {
      setPostingMeme(false);
    }
  };

  const votePost = async (postId, vote) => {
    if (!activeSession || !participant) return;

    setError("");
    try {
      const response = await axios.post(
        `${BACKEND_BASE_URL}/api/sessions/${activeSession.code}/posts/${postId}/vote`,
        {
          participantId: participant.id,
          vote,
        },
      );
      setActiveSession(response.data.session);
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to submit vote.");
    }
  };

  const downloadMeme = async () => {
    if (!memeRef.current || !generatedMeme) return;

    try {
      const canvas = await html2canvas(memeRef.current, { scale: 2, useCORS: true });
      const imageUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = `battle-meme-${Date.now()}.png`;
      link.click();
    } catch (_err) {
      setError("Failed to download meme image.");
    }
  };

  useEffect(() => {
    const onHashChange = () => setMode(getModeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("memex_admin_tokens");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          setAdminTokens(parsed);
        }
      }
    } catch (_error) {
      // ignore local storage parse issues
    }
  }, []);

  useEffect(() => {
    if (mode === "admin") {
      refreshMatches();
      refreshAdminSessions();
    }
  }, [mode]);

  useEffect(() => {
    if (!activeSession?.code || mode !== "play") return;
    const id = setInterval(() => {
      loadSession(activeSession.code, { resetLocalState: false });
    }, 10000);
    return () => clearInterval(id);
  }, [activeSession?.code, mode]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <p className="league-tag">MEME BATTLE ARENA</p>
        <h1>IPL Session Wars</h1>
        <p className="subtitle">
          Separate admin dashboard and participant battle room.
        </p>
        <div className="mode-tabs">
          <a className={mode === "admin" ? "tab active" : "tab"} href="#/admin">
            Admin Page
          </a>
          <a className={mode === "play" ? "tab active" : "tab"} href="#/play">
            Participant Page
          </a>
        </div>
      </header>

      {error && <p className="error-text">{error}</p>}

      {mode === "admin" && (
        <>
          <section className="panel">
            <h2>Admin: Create Session</h2>
            <div className="row">
              <button className="ghost-button" onClick={refreshMatches} disabled={loadingMatches}>
                {loadingMatches ? "Refreshing..." : "Fetch Matches"}
              </button>
              <select
                className="match-select"
                value={selectedMatchId}
                onChange={(event) => setSelectedMatchId(event.target.value)}
                disabled={loadingMatches || matches.length === 0}
              >
                {matches.length === 0 && <option value="">No matches</option>}
                {matches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {match.name}
                  </option>
                ))}
              </select>
              <button className="neon-button" onClick={createSession} disabled={creatingSession || !selectedMatch}>
                {creatingSession ? "Creating..." : "Create Session"}
              </button>
            </div>
            {createdCode && <p className="hint">Latest session code: <b>{createdCode}</b></p>}
          </section>

          <section className="panel">
            <h2>Admin: All Sessions</h2>
            <div className="row">
              <button className="ghost-button" onClick={refreshAdminSessions} disabled={loadingAdminSessions}>
                {loadingAdminSessions ? "Refreshing..." : "Refresh Sessions"}
              </button>
            </div>
            <div className="session-list">
              {sessionsList.length === 0 && <p className="hint">No sessions created yet.</p>}
              {sessionsList.map((session) => {
                const canEnd = session.status === "ACTIVE" && Boolean(adminTokens[session.code]);
                return (
                  <article className="session-card" key={session.code}>
                    <p className="hint"><b>Code:</b> {session.code}</p>
                    <p className="hint"><b>Status:</b> {session.status}</p>
                    <p className="hint"><b>Match:</b> {session.match?.name}</p>
                    <p className="hint"><b>Participants:</b> {session.participantsCount}</p>
                    <p className="hint"><b>{session.teams?.[0]}:</b> {session.scores?.[session.teams?.[0]] ?? 0}</p>
                    <p className="hint"><b>{session.teams?.[1]}:</b> {session.scores?.[session.teams?.[1]] ?? 0}</p>
                    <div className="row">
                      <button
                        className="ghost-button"
                        onClick={() => endSessionAsAdmin(session.code)}
                        disabled={!canEnd || endingSessionCode === session.code}
                      >
                        {endingSessionCode === session.code ? "Ending..." : "End Session"}
                      </button>
                      {!adminTokens[session.code] && session.status === "ACTIVE" && (
                        <span className="hint">Not created in this browser</span>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </>
      )}

      {mode === "play" && (
        <>
          <section className="panel">
            <h2>Participant: Join Session</h2>
            <div className="row">
              <input
                className="text-input"
                placeholder="Enter session code"
                value={sessionCodeInput}
                onChange={(event) => setSessionCodeInput(event.target.value.toUpperCase())}
              />
              <button className="ghost-button" onClick={() => loadSession(sessionCodeInput)} disabled={loadingSession}>
                {loadingSession ? "Loading..." : "Open Session"}
              </button>
            </div>

            {activeSession && (
              <>
                <div className="match-summary">
                  <p className="hint"><b>Code:</b> {activeSession.code}</p>
                  <p className="hint"><b>Status:</b> {activeSession.status}</p>
                  <p className="hint"><b>Match:</b> {activeSession.match.name}</p>
                  <p className="hint"><b>Match Status:</b> {activeSession.match.status}</p>
                  {activeSession.endedAt && (
                    <p className="hint"><b>Ended At:</b> {new Date(activeSession.endedAt).toLocaleString()}</p>
                  )}
                </div>

                <div className="scoreboard">
                  <div className="score-card">
                    <p>{teamA}</p>
                    <h3>{activeSession.scores?.[teamA] ?? 0}</h3>
                  </div>
                  <div className="score-card">
                    <p>{teamB}</p>
                    <h3>{activeSession.scores?.[teamB] ?? 0}</h3>
                  </div>
                </div>

                {!participant && (
                  <div className="row join-row">
                    <input
                      className="text-input"
                      placeholder="Your name"
                      value={participantName}
                      onChange={(event) => setParticipantName(event.target.value)}
                    />
                    <select
                      className="match-select"
                      value={selectedTeam}
                      onChange={(event) => setSelectedTeam(event.target.value)}
                    >
                      <option value={teamA}>{teamA}</option>
                      <option value={teamB}>{teamB}</option>
                    </select>
                    <button className="neon-button" onClick={joinSession} disabled={joining || isSessionEnded}>
                      {joining ? "Joining..." : "Join as Supporter"}
                    </button>
                  </div>
                )}

                {isSessionEnded && (
                  <p className="error-text">Session has ended. Battle actions are locked.</p>
                )}

                {participant && (
                  <p className="hint">
                    Joined as <b>{participant.name}</b> supporting <b>{participant.team}</b>
                  </p>
                )}
              </>
            )}
          </section>

          {activeSession && participant && (
            <section className="panel">
              <h2>Meme Generator</h2>
              <div className="row">
                <button className="neon-button" onClick={generateMeme} disabled={generatingMeme || isSessionEnded}>
                  {generatingMeme ? "Generating..." : "Generate Meme"}
                </button>
                <button className="ghost-button" onClick={downloadMeme} disabled={!generatedMeme}>
                  Download Meme
                </button>
                <button className="ghost-button" onClick={postMeme} disabled={!generatedMeme || postingMeme || isSessionEnded}>
                  {postingMeme ? "Posting..." : "Post to Feed"}
                </button>
              </div>

              <section ref={memeRef} className="meme-card theme-a">
                <div className="overlay" />
                <p className="event-label">{generatedMeme?.event || "Generate a meme to preview"}</p>
                <p className="caption-text">
                  {generatedMeme?.caption || "Your generated caption will appear here."}
                </p>
              </section>
            </section>
          )}

          {activeSession && (
            <section className="panel">
              <h2>Battle Feed</h2>
              <div className="feed-list">
                {activeSession.posts?.length === 0 && <p className="hint">No memes posted yet.</p>}
                {activeSession.posts?.map((post) => (
                  <article key={post.id} className="feed-card">
                    <p className="hint">
                      <b>{post.participantName}</b> • {post.team}
                    </p>
                    <p className="event-label">{post.event}</p>
                    <p className="feed-caption">{post.caption}</p>
                    <div className="vote-row">
                      <button className="vote-button" onClick={() => votePost(post.id, 1)} disabled={!participant || isSessionEnded}>
                        Upvote ({post.upvotes})
                      </button>
                      <button className="vote-button down" onClick={() => votePost(post.id, -1)} disabled={!participant || isSessionEnded}>
                        Downvote ({post.downvotes})
                      </button>
                      <span className="hint">Score: {post.score}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

export default App;
