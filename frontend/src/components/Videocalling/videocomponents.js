import React, { useRef, useEffect, useState } from "react";
import styled from "styled-components";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Button } from "@ui/button";
import { Mic, MicOff, Video, VideoOff } from "lucide-react";

gsap.registerPlugin(useGSAP);

const Videocomponents = ({
  track,
  kind,
  serverConsumerId,
  producerId,
  consumerTransports,
  socket,
  Selftrack,
}) => {
  const [isVideoPaused, setIsVideoPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const container = useRef();
  const { contextSafe } = useGSAP({ scope: container });
  const mediaRef = useRef();

  const handleMuteToggle = () => {
    if (track && kind === "audio") {
      const newMuteState = !isMuted;
      track.enabled = !newMuteState;
      setIsMuted(newMuteState);
    }
  };

  useEffect(() => {
    const handleError = (err) => {
      console.error("Socket error:", err);
      // Optionally show some UI feedback to the user
    };

    socket.on("error", handleError);

    return () => {
      socket.off("error", handleError);
    };
  }, [socket]);

  const handleVideoToggle = () => {
    if (kind === "video") {
      if (!isVideoPaused) {
        socket.emit(
          "consumer-pause",
          {
            producerId: producerId,
            serverConsumerId: serverConsumerId,
          },
          () => {
            setIsVideoPaused(true); // Update state to reflect video is paused
            Videopactiy();
          }
        );
      } else {
        socket.emit(
          "consumer-resume",
          {
            serverConsumerId: serverConsumerId,
            producerId: producerId,
          },
          () => {
            setIsVideoPaused(false); // Update state to reflect video is resumed
            Videoresume();
          }
        );
      }
    }
  };

  useEffect(() => {
    if (mediaRef.current && track) {
      const stream = new MediaStream([track]);
      mediaRef.current.srcObject = stream;

      return () => {
        if (mediaRef.current) {
          mediaRef.current.srcObject = null;
        }
      };
    }
  }, [track]);

  const Videopactiy = contextSafe(() => {
    gsap.to(".VideoOverlay", {
      opacity: 1,
      duration: 0.5,
      display: "flex",
    });
  });

  const Videoresume = contextSafe(() => {
    gsap.to(".VideoOverlay", {
      opacity: 0,
      duration: 0.5,
      onComplete: () => {
        document.querySelector(".VideoOverlay").style.display = "none";
      },
    });
  });

  return kind === "video" ? (
    <div className="aspect-video bg-[#2f3136] rounded-lg overflow-hidden relative w-full max-w-[450px] max-md:max-w-[300px]">
      <video
        ref={mediaRef}
        className="w-full h-full object-cover Video"
        muted={isMuted}
        autoPlay
        playsInline
      >
        Your browser does not support the video tag.
      </video>
      <div
        className="VideoOverlay absolute top-0 left-0 w-full h-full bg-black bg-opacity-75 flex items-center justify-center"
        style={{ display: isVideoPaused ? "flex" : "none", opacity: 0 }}
      >
        <div className="text-white text-lg">Video Paused</div>
      </div>
      <div className="absolute bottom-2 left-2 bg-gradient-to-r from-purple-500 to-blue-500 text-white px-3 py-1 rounded-full text-sm shadow-lg">
        User
      </div>
      {/* <div className="absolute top-2 right-2 flex space-x-2">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full bg-black bg-opacity-50 hover:bg-opacity-75"
          onClick={handleMuteToggle}
        >
          {isMuted ? (
            <MicOff className="h-4 w-4 text-white" />
          ) : (
            <Mic className="h-4 w-4 text-white" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full bg-black bg-opacity-50 hover:bg-opacity-75"
          onClick={handleVideoToggle}
        >
          {isVideoPaused ? (
            <VideoOff className="h-4 w-4 text-white" />
          ) : (
            <Video className="h-4 w-4 text-white" />
          )}
        </Button>
      </div> */}
    </div>
  ) : (
    <audio ref={mediaRef} autoPlay muted={isMuted}></audio>
  );
};

export default Videocomponents;
