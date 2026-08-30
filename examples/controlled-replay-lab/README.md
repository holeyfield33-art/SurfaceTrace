# Controlled Replay Lab

This folder is a separate teaching application for the P10 replay-learning closure.

## What it is

- A synthetic localhost-only lab for practicing one-variable replay reasoning
- A place to observe deterministic baseline, comparison, redirect, slow, and large-response behavior
- A boundary-separated teaching system that is not part of the SurfaceTrace production server

## What it is not

- Not a proxy
- Not a crawler
- Not a bulk replay tool
- Not an exploit generator
- Not a public deployment target

## Start

```bash
node lab.mjs
```

Defaults:

- Host: `127.0.0.1`
- Port: `4040`

## Routes

- `GET /lab/projects/100` - known baseline object
- `GET /lab/projects/200` - controlled comparison object
- `GET /lab/redirect` - redirect response only
- `GET /lab/slow` - slow deterministic response
- `GET /lab/large` - bounded large response exercise

## Safety

- The lab refuses non-loopback binding unless `LAB_UNSAFE_HOST=allow-nonloopback` is set explicitly.
- It uses synthetic data only.
- It never auto-starts from the SurfaceTrace production server.
