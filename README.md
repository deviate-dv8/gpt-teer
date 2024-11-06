# gpt-teer

A rework to my depricated project gpt-wright project, Puppeteer have better stealth-mode integration than playwright

### ChatGPT 4o mini/3.5 Turbo reverse proxy with Chromium/Firefox based Puppeteer, Express REST-API, A free non-fine-tunable REST-API alternative for GPT chat completion API

## Routes

GET / - Information or Health Check

POST /start - Generates a Chat ID - kills inactivity after 15 mins

POST /conversation - Prompt chat [ requires on request-body {prompt:string} ]

supports multiple chat conversations

## How it works

Uses Puppeteer with Stealth plugin to always have unique browser configurations (and also bypasses cloudflare allowing almost limitless API calls and ChatGPT 1 hour limit prompts, Can generate 50k prompts in 24 hours on 12 threads CPU with medium length response or around 1-2k tokens)

Applies parallel API calls with each dependent Chat ID to have a 'Queue middleware'/it waits for pending response to finish (recurring chats must be finished before the next prompt is processed, or waiting for chatgpt to response before the next prompt is processed, this only applies if there are many pending prompts on the same ChatID)

This process uses ChatGPT no logins prompts which is similar to doing OPEN AI chat_completion API but free (but lacks the ability to fine tune)

Disclaimer: This must be used with caution as abuse on the OpenAI server may result in rate limiting issues based on IPs
