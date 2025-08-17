import React, { useEffect, useState, useCallback, useRef } from "react";
import "./App.css";

export default function App() {
    /* =========================
     * State & Refs
     * ========================= */
    const [supported, setSupported] = useState(false);
    const [permission, setPermission] = useState("prompt");
    const [screens, setScreens] = useState([]);
    const [error, setError] = useState("");
    const [streams, setStreams] = useState({});
    const [controlling, setControlling] = useState({});
    const [expanded, setExpanded] = useState(null);
    const [aspect, setAspect] = useState({});
    const videoRefs = useRef({});

    /* =========================
     * Utilities
     * ========================= */
    const send = useCallback((cmd) => {
        fetch("http://127.0.0.1:27272/input", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cmd),
        }).catch(() => {});
    }, []);

    const bindPreviewHandlers = useCallback(
        (videoEl, screenObj) => {
            if (!videoEl || !screenObj) return () => {};

            const getRect = () => videoEl.getBoundingClientRect();
            const toNorm = (e) => {
                const r = getRect();
                return {
                    x: (e.clientX - r.left) / r.width,
                    y: (e.clientY - r.top) / r.height,
                };
            };

            const display = {
                left: screenObj.left ?? 0,
                top: screenObj.top ?? 0,
                width: screenObj.width ?? window.screen.width,
                height: screenObj.height ?? window.screen.height,
            };

            let lastMoveTs = 0;

            const onMove = (e) => {
                const now = performance.now();
                if (now - lastMoveTs < 8) return;
                lastMoveTs = now;
                const { x, y } = toNorm(e);
                send({ type: "move", x, y, display });
            };

            const onDown = (e) => {
                const { x, y } = toNorm(e);
                send({
                    type: "click",
                    x,
                    y,
                    display,
                    button:
                        e.button === 2 ? "right" : e.button === 1 ? "middle" : "left",
                    count: e.detail || 1,
                });
            };

            const onWheel = (e) => {
                const { x, y } = toNorm(e);
                send({ type: "wheel", x, y, display, deltaY: e.deltaY });
            };

            const preventMenu = (e) => e.preventDefault();

            videoEl.addEventListener("mousemove", onMove);
            videoEl.addEventListener("mousedown", onDown);
            videoEl.addEventListener("wheel", onWheel, { passive: true });
            videoEl.addEventListener("contextmenu", preventMenu);

            return () => {
                videoEl.removeEventListener("mousemove", onMove);
                videoEl.removeEventListener("mousedown", onDown);
                videoEl.removeEventListener("wheel", onWheel);
                videoEl.removeEventListener("contextmenu", preventMenu);
            };
        },
        [send]
    );

    const attachListeners = useCallback((screenDetails) => {
        const update = () => setScreens([...screenDetails.screens]);
        update();
        screenDetails.addEventListener("screenschange", update);
        screenDetails.addEventListener("currentscreenchange", update);
        return () => {
            screenDetails.removeEventListener("screenschange", update);
            screenDetails.removeEventListener("currentscreenchange", update);
        };
    }, []);

    const requestAccess = useCallback(async () => {
        setError("");
        try {
            const details = await window.getScreenDetails();
            setPermission("granted");
            return attachListeners(details);
        } catch (e) {
            setPermission("denied");
            setScreens([window.screen]);
            setError(e?.message || String(e));
            return () => {};
        }
    }, [attachListeners]);

    /* =========================
     * Effects: capability & permission
     * ========================= */
    useEffect(() => {
        const ok = "getScreenDetails" in window;
        setSupported(ok);

        (async () => {
            if (!ok) return;
            try {
                if (navigator.permissions?.query) {
                    const st = await navigator.permissions.query({
                        name: "window-management",
                    });
                    setPermission(st.state);
                    st.onchange = () => setPermission(st.state);
                }
            } catch {}
        })();
    }, []);

    useEffect(() => {
        let detach = () => {};
        if (supported && permission === "granted") {
            requestAccess().then((off) => (detach = off || (() => {})));
        }
        return () => detach();
    }, [supported, permission, requestAccess]);

    /* =========================
     * Effects: video streams attach/play
     * ========================= */
    useEffect(() => {
        Object.entries(streams).forEach(async ([k, stream]) => {
            const i = Number(k);
            const v = videoRefs.current[i];
            if (!v) return;
            if (v.srcObject === stream) return;

            v.srcObject = stream;

            await new Promise((res) => {
                if (v.readyState >= 1) res();
                else v.onloadedmetadata = () => res();
            }).catch(() => {});

            try {
                const w = v.videoWidth || 16;
                const h = v.videoHeight || 9;
                setAspect((prev) => ({ ...prev, [i]: { w, h } }));

                await v.play();
            } catch {
                setTimeout(() => v.play().catch(() => {}), 120);
            }
        });
    }, [streams]);

    /* =========================
     * Effects: bind/unbind remote-control handlers
     * ========================= */
    useEffect(() => {
        const cleanups = [];
        screens.forEach((s, i) => {
            const el = videoRefs.current[i];
            const hasStream = Boolean(streams[i]);
            const isControlling = Boolean(controlling[i]);
            if (el && hasStream && isControlling) {
                const off = bindPreviewHandlers(el, s);
                if (typeof off === "function") cleanups.push(off);
            }
        });
        return () => cleanups.forEach((off) => off && off());
    }, [screens, streams, controlling, bindPreviewHandlers]);

    /* =========================
     * Effects: set return target
     * ========================= */
    useEffect(() => {
        const primary = screens.find((s) => s.isPrimary) || screens[0];
        if (!primary) return;
        send({
            type: "setReturnTarget",
            display: {
                left: primary.left ?? 0,
                top: primary.top ?? 0,
                width: primary.width ?? window.screen.width,
                height: primary.height ?? window.screen.height,
            },
        });
    }, [screens, send]);

    /* =========================
     * Capture controls
     * ========================= */
    function stopCapture(i) {
        setStreams((prev) => {
            const st = prev[i];
            if (st) st.getTracks().forEach((t) => t.stop());
            const next = { ...prev };
            delete next[i];
            return next;
        });
        setControlling((prev) => ({ ...prev, [i]: false }));

        const v = videoRefs.current[i];
        if (v) v.srcObject = null;

        setExpanded((cur) => (cur === i ? null : cur));
    }

    async function startCapture(i) {
        setError("");
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    displaySurface: "monitor",
                    logicalSurface: true,
                    frameRate: { ideal: 30, max: 60 },
                },
                audio: false,
            });
            stopCapture(i);
            setStreams((prev) => ({ ...prev, [i]: stream }));
            setControlling((prev) => ({ ...prev, [i]: false }));

            const [track] = stream.getVideoTracks();
            track.addEventListener("ended", () => stopCapture(i));
        } catch (e) {
            if (e?.name === "NotAllowedError") return;
            setError(e?.message || String(e));
        }
    }

    /* =========================
     * UI helpers
     * ========================= */
    function scrollToTopSmooth() {
        requestAnimationFrame(() =>
            window.scrollTo({ top: 0, behavior: "smooth" })
        );
    }

    function scrollElementToCenter(el) {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const elTop = rect.top + window.scrollY;
        const target = elTop - (window.innerHeight - rect.height) / 2;

        const maxY = Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight
        );
        const clamped = Math.max(0, Math.min(target, maxY));

        requestAnimationFrame(() =>
            window.scrollTo({ top: clamped, behavior: "smooth" })
        );
    }

    function toggleExpand(i) {
        if (expanded === i) {
            setExpanded(null);
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const el = document.getElementById(`card-${i}`);
                    if (el) scrollElementToCenter(el);
                });
            });
        } else {
            setExpanded(i);
            requestAnimationFrame(() => scrollToTopSmooth());
        }
    }

    /* =========================
     * Data
     * ========================= */
    const items = [
        ...screens,
        ...Array.from({ length: 10 }, (_, idx) => ({
            label: `Dummy Display ${idx + 1}`,
            width: 1920,
            height: 1080,
            isPrimary: false,
        })),
    ];

    /* =========================
     * Render
     * ========================= */
    const renderCard = (s, i) => {
        const label = s.label || `Display ${i + 1}`;
        const hasStream = Boolean(streams[i]);
        const isControlling = Boolean(controlling[i]);
        const ratioStr = aspect[i]
            ? `${aspect[i].w} / ${aspect[i].h}`
            : s?.width && s?.height
                ? `${s.width} / ${s.height}`
                : "16 / 9";

        return (
            <div
                id={`card-${i}`}
                className={`card ${expanded === i ? "expanded" : ""}`}
                key={i}
            >
                <button
                    className="btn btn-icon expand-btn"
                    onClick={() => toggleExpand(i)}
                    title={expanded === i ? "Shrink" : "Expand"}
                >
                    {expanded === i ? "—" : "⤢"}
                </button>

                <div className="title">{label}</div>

                <div
                    className={`preview ${hasStream && !isControlling ? "control-ready" : ""}`}
                    style={{ aspectRatio: ratioStr }}
                    onClick={() => {
                        if (hasStream && !isControlling)
                            setControlling((p) => ({ ...p, [i]: true }));
                    }}
                    onMouseLeave={() => {
                        if (hasStream && isControlling)
                            setControlling((p) => ({ ...p, [i]: false }));
                    }}
                >
                    {!hasStream && (
                        <div className="overlay disconnected">Disconnected</div>
                    )}
                    {hasStream && !isControlling && (
                        <div className="overlay control-hint">Click to control</div>
                    )}
                    <video
                        className={`video ${!hasStream ? "no-stream" : ""}`}
                        ref={(el) => (videoRefs.current[i] = el)}
                        autoPlay
                        playsInline
                        muted
                        onLoadedMetadata={(e) => {
                            const v = e.currentTarget;
                            const w = v.videoWidth || 16;
                            const h = v.videoHeight || 9;
                            setAspect((prev) => ({ ...prev, [i]: { w, h } }));
                        }}
                    />
                </div>

                <div className="actions">
                    {!hasStream ? (
                        <button className="btn" onClick={() => startCapture(i)}>
                            Connect
                        </button>
                    ) : (
                        <button className="btn danger" onClick={() => stopCapture(i)}>
                            Disconnect
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="wrap">
            <header className="toolbar">
                <h2>Displays Controller</h2>
                <div className="toolbar-right">
                    {supported ? (
                        permission !== "granted" && (
                            <button className="btn" onClick={requestAccess}>
                                Allow display access
                            </button>
                        )
                    ) : (
                        <span className="warn">Unsupported browser</span>
                    )}
                    <div className="hint">
                        Press <span className="kbd">Ctrl/Cmd</span> +{" "}
                        <span className="kbd">Backspace</span> to return mouse
                    </div>
                </div>
            </header>

            {error && <div className="error">Error: {error}</div>}

            <div className="grid">
                {expanded !== null && renderCard(items[expanded], expanded)}
                {items.map((s, i) => (expanded === i ? null : renderCard(s, i)))}
            </div>
        </div>
    );
}
