import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VideoPlayer } from "./video-player";
import { lessons } from "@/lib/content";

vi.mock("next-intl", () => ({ useLocale: () => "en" }));
afterEach(cleanup);

it("does not show a buffering overlay when a loaded lesson is paused", () => {
  const { container } = render(<VideoPlayer asset={lessons[0].assets} title="Candles" onVideoPlay={()=>{}} onVideoComplete={()=>{}} />);
  const video = container.querySelector("video")!;
  fireEvent.loadedMetadata(video);
  fireEvent.waiting(video);
  expect(screen.queryByText("Loading video...")).toBeNull();
  Object.defineProperty(video, "paused", { configurable: true, value: false });
  fireEvent.waiting(video);
  expect(screen.queryByText("Loading video...")).not.toBeNull();
  fireEvent.pause(video);
  expect(screen.queryByText("Loading video...")).toBeNull();
});

it("keeps a media error visible when the player pauses", () => {
  const onError = vi.fn();
  const { container } = render(<VideoPlayer asset={lessons[0].assets} title="Candles" onVideoPlay={()=>{}} onVideoComplete={()=>{}} onVideoError={onError} />);
  const video = container.querySelector("video")!;
  fireEvent.error(video);
  fireEvent.pause(video);
  expect(screen.queryByText("This video could not be loaded inside the lesson.")).not.toBeNull();
  expect(onError).toHaveBeenCalledOnce();
});
