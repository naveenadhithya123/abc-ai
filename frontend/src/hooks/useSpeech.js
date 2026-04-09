import { useEffect, useRef, useState } from "react";

export function useSpeech() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingText, setSpeakingText] = useState("");
  const transcriptRef = useRef("");
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const rafRef = useRef(null);
  const recognitionRef = useRef(null);
  const utteranceRef = useRef(null);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.stop?.();
      window.speechSynthesis?.cancel();
    };
  }, []);

  function monitorAudioLevel() {
    if (!analyserRef.current) {
      return;
    }

    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(data);

    let total = 0;
    for (const value of data) {
      const centered = (value - 128) / 128;
      total += centered * centered;
    }

    const rms = Math.sqrt(total / data.length);
    setAudioLevel(Math.min(1, rms * 5));
    rafRef.current = requestAnimationFrame(monitorAudioLevel);
  }

  async function beginAudioMeter() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    streamRef.current = stream;
    audioContextRef.current = audioContext;
    analyserRef.current = analyser;
    monitorAudioLevel();
  }

  function stopAudioMeter() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    setAudioLevel(0);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
  }

  async function startRecording() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      throw new Error("Speech recognition is not supported in this browser.");
    }

    setTranscript("");
    transcriptRef.current = "";
    await beginAudioMeter();

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = "";
      for (let index = 0; index < event.results.length; index += 1) {
        finalText += `${event.results[index][0].transcript} `;
      }
      transcriptRef.current = finalText.trim();
      setTranscript(transcriptRef.current);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      stopAudioMeter();
    };

    recognition.onend = () => {
      setIsRecording(false);
      stopAudioMeter();
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }

  async function stopRecording() {
    if (!recognitionRef.current) {
      return transcriptRef.current.trim();
    }

    return new Promise((resolve) => {
      const finalText = () => {
        resolve(transcriptRef.current.trim());
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
        stopAudioMeter();
        finalText();
      };

      recognitionRef.current.stop();
    });
  }

  async function speak(text) {
    if (!text) {
      return;
    }

    const normalized = text.trim();

    if (isSpeaking && speakingText === normalized) {
      window.speechSynthesis?.cancel();
      setIsSpeaking(false);
      setSpeakingText("");
      utteranceRef.current = null;
      return;
    }

    window.speechSynthesis?.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingText("");
      utteranceRef.current = null;
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingText("");
      utteranceRef.current = null;
    };
    utteranceRef.current = utterance;
    setIsSpeaking(true);
    setSpeakingText(normalized);
    window.speechSynthesis?.speak(utterance);
  }

  return {
    isRecording,
    audioLevel,
    transcript,
    isSpeaking,
    speakingText,
    startRecording,
    stopRecording,
    speak,
  };
}
