import React, { useEffect, useState, useCallback, useRef } from "react";
import "./App.css";

export default function App() {
    const [supported, setSupported] = useState(false);
    const [permission, setPermission] = useState("prompt");
    const [screens, setScreens] = useState([]);
    const [error, setError] = useState("");

    const [streams, setStreams] = useState({});
    const videoRefs = useRef({});

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

    useEffect(() => {
        const ok = "getScreenDetails" in window;
        setSupported(ok);
        (async () => {
            if (!ok) return;
            try {
                if (navigator.permissions?.query) {
                    const st = await navigator.permissions.query({ name: "window-management" });
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
            try { await v.play(); } catch { setTimeout(() => v.play().catch(() => {}), 120); }
        });
    }, [streams]);

    function stopCapture(i) {
        setStreams((prev) => {
            const st = prev[i];
            if (st) st.getTracks().forEach((t) => t.stop());
            const next = { ...prev };
            delete next[i];
            return next;
        });
        const v = videoRefs.current[i];
        if (v) v.srcObject = null;
    }

    async function startCapture(i) {
        setError("");
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { displaySurface: "monitor", logicalSurface: true, frameRate: { ideal: 30, max: 60 } },
                audio: false,
            });
            stopCapture(i);
            setStreams((prev) => ({ ...prev, [i]: stream }));
            const [track] = stream.getVideoTracks();
            track.addEventListener("ended", () => stopCapture(i));
        } catch (e) {
            if (e?.name === "NotAllowedError") return;
            setError(e?.message || String(e));
        }
    }

    return (
        <div className="wrap">
            <header className="toolbar">
                <h2>Displays Controller</h2>
                {supported ? (
                    permission !== "granted" && (
                        <button className="btn" onClick={requestAccess}>Allow display access</button>
                    )
                ) : (
                    <span className="warn">Unsupported browser</span>
                )}
            </header>

            {error && <div className="error">Error: {error}</div>}

            <div className="grid">
                {screens.map((s, i) => {
                    const label = s.label || `Display ${i + 1}`;
                    const hasStream = Boolean(streams[i]);
                    return (
                        <div className="card" key={i}>
                            <div className="title">{label}</div>

                            <div className="preview">
                                <video
                                    className="video"
                                    ref={(el) => (videoRefs.current[i] = el)}
                                    autoPlay
                                    playsInline
                                    muted
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
                })}
            </div>
        </div>
    );
}
