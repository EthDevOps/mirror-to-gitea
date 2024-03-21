# Automatically Mirror Github Repo To Your Gitea Server

## Badges

[![image pulls](https://img.shields.io/docker/pulls/jaedle/mirror-to-gitea.svg)](https://cloud.docker.com/repository/docker/jaedle/mirror-to-gitea)

## Description

This script automatically mirrors the repositories from a github-user or github-organization to your gitea server.
Once started, it will create a mirrored repository under a given token for a gitea user, completely automatically.

Example:
A github user `github-user` has public repositories `dotfiles` and `zsh-config`.
Starting the script with a gitea token for the account `gitea-user` will create the following mirrored repositories:

- github.com/github-user/dotfiles &rarr; your-gitea.url/gitea-user/dotfiles
- github.com/github-user/zsh-config &rarr; your-gitea.url/gitea-user/zsh-config

The mirror settings are default by your gitea instance.

It is also possible to mirror private repos, which can be configred here in [#parameters](#parameters). When mirroring private repos, they will be created as private repos on your gitea server.

## Prerequisites

- A github user or organization with repositories
- Configured Gitea instance up and running
- User for Gitea with generated token (Settings -> Applications -> Generate New Token)
- Docker or Docker Compose

### Docker Run

```sh
docker run \
 -d \
 --restart always \
 -e GITHUB_USERNAME=github-user \
 -e GITEA_URL=https://your-gitea.url \
 -e GITEA_TOKEN=please-exchange-with-token \
 jaedle/mirror-to-gitea:latest
```

This will a spin up a docker container which will run forever, mirroring all your repositories once every hour to your gitea server.

### Docker Compose

```yaml
version: "3.3"
services:
    mirror-to-gitea:
        image: jaedle/mirror-to-gitea:latest
        restart: always
        environment:
          - GITHUB_USERNAME=github-user
          - GITEA_URL=https://your-gitea.url
          - GITEA_TOKEN=please-exchange-with-token
          #- GITHUB_TOKEN=please-exchange-with-token # Optional, set to mirror private repos
          #- MIRROR_PRIVATE_REPOSITORIES=true # Optional, set to mirror private repos
          # - DELAY=3600 # Optional, set to change the delay between checks (in seconds)
        container_name: mirror-to-gitea
```
## Building from Source

### Prerequisites
- NodeJS
- NPM

### Build
```sh
npm install
```
If errors occur, try deleting the `package-lock.json` file and run `npm install` again.

### Build Docker Image
```sh
docker build -t mirror-to-gitea .
```

### Run With NodeJS
```sh
export GITHUB_USERNAME=github-user
export GITEA_URL=https://your-gitea.url
export GITEA_TOKEN=please-exchange-with-token
node src/index.js
```
Also export `GITHUB_TOKEN` and `MIRROR_PRIVATE_REPOSITORIES` if you want to mirror private repos, or `DELAY` if you want to change the delay between checks.

### Run With Docker
In the above Docker run command, replace `jaedle/mirror-to-gitea:latest` with `mirror-to-gitea`.
In your Docker Compose file, replace `jaedle/mirror-to-gitea:latest` with `build: .`. Then run `docker compose build` and `docker compose up -d`.

## Parameters

### Required
- `GITHUB_USERNAME`: The name of your user or organization which public repos should be mirrored
- `GITEA_URL`: The url of your gitea server
- `GITEA_TOKEN`: The token for your gitea user (Settings -> Applications -> Generate New Token)
- `MIRROR_MODE`: `single` or `yaml`
- `YAML_URL`: URL to load a yaml file from that lists organisations to mirror under a `orgs` key

### Optional
- `GITHUB_TOKEN`: [GitHub personal access token](https://docs.github.com/en/free-pro-team@latest/github/authenticating-to-github/creating-a-personal-access-token). **Attention: if this is set, the token will be transmitted to your specified Gitea instance!**
- `MIRROR_PRIVATE_REPOSITORIES`: If set to `true`, your private GitHub repositories will also be mirrored to gitea. The `GITHUB_TOKEN` parameter must be set for this to work.
- `DELAY`: How often to check for new repositories in seconds. Default is 3600 (1 hour).

## Things to do

- Refactoring
- Think about how to test
- Better logging
- Add gitlab support
- And so on..
