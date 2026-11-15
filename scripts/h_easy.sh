#!/usr/bin/env bash
exec bash "$(dirname "${BASH_SOURCE[0]}")/h_task.sh" "${1:?usage: h_easy.sh <path to ai_demo> [server] [model]}" easy "${@:2}"
