"use client";

import { Pause, Play, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

const samples = {
  hvac: {
    label: "HVAC inquiry",
    text: "Thanks for calling Northstar Heating and Cooling. I can help with your service request. What seems to be happening with your system?",
  },
  plumbing: {
    label: "Plumbing inquiry",
    text: "Thanks for calling Clearflow Plumbing. I’ll collect a few details for the service team. What plumbing issue can we help you with?",
  },
  cleaning: {
    label: "Cleaning quote",
    text: "Thanks for calling Freshwork Cleaning. Are you looking for residential cleaning or a commercial walkthrough?",
  },
};

type SampleKey = keyof typeof samples;

export function AudioDemo() {
  const [sample, setSample] = useState<SampleKey>("hvac");
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  function choose(next: SampleKey) {
    window.speechSynthesis?.cancel();
    setPlaying(false);
    setSample(next);
  }

  function togglePlayback() {
    window.speechSynthesis?.cancel();
    if (playing) {
      setPlaying(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(samples[sample].text);
    utterance.rate = 0.94;
    utterance.onend = () => setPlaying(false);
    window.speechSynthesis.speak(utterance);
    setPlaying(true);
  }

  return (
    <div className="audio-demo">
      <div className="demo-tabs" role="tablist" aria-label="Voice examples">
        {(Object.keys(samples) as SampleKey[]).map((key) => (
          <button
            className={sample === key ? "active" : ""}
            onClick={() => choose(key)}
            key={key}
            role="tab"
            aria-selected={sample === key}
          >
            {samples[key].label}
          </button>
        ))}
      </div>
      <div className="player-row">
        <button className="play-button" onClick={togglePlayback} aria-label={playing ? "Pause sample" : "Play sample"}>
          {playing ? <Pause /> : <Play />}
        </button>
        <div className={`waveform ${playing ? "is-playing" : ""}`} aria-hidden="true">
          {Array.from({ length: 34 }, (_, index) => (
            <i key={index} style={{ height: `${12 + ((17 * index) % 30)}px`, animationDelay: `${index * 28}ms` }} />
          ))}
        </div>
        <Volume2 />
      </div>
      <blockquote>“{samples[sample].text}”</blockquote>
      <p className="demo-disclosure">
        Illustrative browser-voice demonstration. Production voice and conversation behavior are
        configured for each business.
      </p>
    </div>
  );
}
