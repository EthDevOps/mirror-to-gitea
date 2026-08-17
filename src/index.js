const {Octokit} = require('@octokit/rest');
const request = require('superagent');
const {default: PQueue} = require('p-queue');
const yaml = require('js-yaml');
const fs   = require('fs');  

const delay = ms => new Promise(res => setTimeout(res, ms));

// If set, only public github repositories are mirrored, regardless of what
// the used GITHUB_TOKEN would grant access to.
const mirrorPublicRepositoriesOnly = process.env.MIRROR_PUBLIC_REPOSITORIES_ONLY === 'true';

async function getGithubRepositories(username, token, mirrorPrivateRepositories, isOrg, mirrorPublicRepositoriesOnly) {
  const octokit = new Octokit({
    auth: token || null,
  });

  const userType = isOrg ? "orgs" : "users";


  const publicRepositoriesWithForks = await octokit.paginate('GET /:usertype/:username/repos', { username: username, usertype: userType })
      .then(repositories => toRepositoryList(repositories));

  let allRepositoriesWithoutForks = [];
  if(mirrorPrivateRepositories === 'true' && !isOrg && !mirrorPublicRepositoriesOnly){
    allRepositoriesWithoutForks = await octokit
        .paginate('GET /user/repos?visibility=public&affiliation=owner&visibility=private')
        .then(repositories => toRepositoryList(repositories));
  }

  let repositories;
  if(mirrorPrivateRepositories === 'true'){
    repositories = filterDuplicates(allRepositoriesWithoutForks.concat(publicRepositoriesWithForks));
  }else{
    repositories = publicRepositoriesWithForks;
  }

  // A GITHUB_TOKEN also grants access to private repositories in the listings
  // above, so filter them out explicitly when only public ones are wanted.
  if(mirrorPublicRepositoriesOnly){
    const publicRepositories = repositories.filter(repository => !repository.private);
    const skipped = repositories.length - publicRepositories.length;
    if(skipped > 0){
      console.log(`\tSkipping ${skipped} private repositories (MIRROR_PUBLIC_REPOSITORIES_ONLY is set)`);
    }
    return publicRepositories;
  }

  return repositories;
}

function toRepositoryList(repositories) {
  return repositories.map(repository => {
    return { name: repository.name, url: repository.clone_url, private: repository.private };
  });
}

function filterDuplicates(array) {
  var a = array.concat();
  for(var i=0; i<a.length; ++i) {
      for(var j=i+1; j<a.length; ++j) {
          if(a[i].url === a[j].url)
              a.splice(j--, 1);
      }
  }

  return a;
}

async function getGiteaUser(gitea) {
  return request.get(gitea.url
    + '/api/v1/user')
    .set('Authorization', 'token ' + gitea.token)
    .then(response => {
      return { id: response.body.id, name: response.body.username }
    });
}

function isAlreadyMirroredOnGitea(repository, gitea, giteaOrg) {
  const requestUrl = `${gitea.url}/api/v1/repos/${giteaOrg}/${repository}`;
  return request.get(
    requestUrl)
    .set('Authorization', 'token ' + gitea.token)
    .then(() => true)
    .catch(() => false);
}

async function ensureOrg(gitea, org, func) {

  console.log("\tChecking for existing of " + org)
  return await request.get(`${gitea.url}/api/v1/orgs/${org}`)
    .set('Authorization', 'token ' + gitea.token)
    .then(() => {
      console.log("\t\texists already.")
    })
    .catch(async () => {
      console.log(`\tCreating org: ${org}`)
      return await request.post(`${gitea.url}/api/v1/orgs`)
        .set('Authorization', 'token ' + gitea.token)
        .send({
          username: org
        })
        .then(() => {
            console.log("\t\torg created.")

        })

    })
}

async function mirrorOnGitea(repository, gitea, giteaUser, githubToken, giteaOwner, retry) {
  const mirror_ok = await request.post(`${gitea.url}/api/v1/repos/migrate`)
    .set('Authorization', 'token ' + gitea.token)
    .send({
      auth_token: githubToken || null,
      clone_addr: repository.url,
      mirror: true,
      repo_name: repository.name,
      repo_owner: giteaOwner,
      private: repository.private,
      issues: true,
      labels: true,
      lfs: true,
      milestones: true,
      pull_requests: true,
      releases: true,
      wiki: true
    })
    .then(() => {
      console.log(`\t\t${repository.name} done.`);
      return true;
    })
    .catch(err => {
      console.log(`\t\t${repository.name} Failed: ${err.response.res.statusMessage}`);
      return false;
    });

  if(!mirror_ok && !retry) {
    console.log(`\tRetrying ${repository.name} in 10sec`);
    await delay(10000);

    // Delete repo
    console.log('\tDeleting bad repo...')
    await request.delete(`${gitea.url}/api/v1/repos/${giteaOwner}/${repository.name}`)
      .set('Authorization', 'token ' + gitea.token)
      .then(() => console.log('\t\tdeleted.'))
      .catch(err => {
        const status = err.response && err.response.status;
        console.log(`\t\tDelete failed (continuing): ${status || err.message}`);
      });

    await delay(5000);
    console.log("\tRetrying...")
    await mirrorOnGitea(repository, gitea, giteaUser, githubToken, giteaOwner, true)
  }

}

async function mirror(repository, gitea, giteaUser, githubToken, giteaOwner) {
  if (await isAlreadyMirroredOnGitea(repository.name,
    gitea,
    giteaOwner)) {
    console.log('\tRepository is already mirrored; doing nothing: ', repository.name);
    return;
  }
  console.log('\tMirroring repository to gitea: ', repository.name);
  await mirrorOnGitea(repository, gitea, giteaUser, githubToken, giteaOwner, false);
  await delay(2500)
}

async function createMirrorsOnGitea(repos, githubUsername) {
  const giteaUrl = process.env.GITEA_URL;
  if (!giteaUrl) {
    console.error('No GITEA_URL specified, please specify! Exiting..');
    return;
  }

  const giteaToken = process.env.GITEA_TOKEN;
  if (!giteaToken) {
    console.error('No GITEA_TOKEN specified, please specify! Exiting..');
    return;
  }
  
  const githubToken = process.env.GITHUB_TOKEN;
  const gitea = {
    url: giteaUrl,
    token: giteaToken,
  };
  const giteaUser = await getGiteaUser(gitea);
  await ensureOrg(gitea, githubUsername)

  console.log("\tCreating Mirrors for " + githubUsername)
  for(let r of repos) {
    await mirror(r, gitea, giteaUser, githubToken, githubUsername);
  }
  console.log("\tdone with " + githubUsername)



}

async function singleOrg() {
  const githubUsernameAll = process.env.GITHUB_USERNAME.split(':');
  const githubUsername = githubUsernameAll[0]
  if (!githubUsername) {
    console.error('No GITHUB_USERNAME specified, please specify! Exiting..');
    return;
  }

  const isOrg = githubUsernameAll.length > 0 && githubUsernameAll[1] === "org"

  const githubToken = process.env.GITHUB_TOKEN;

  const mirrorPrivateRepositories = process.env.MIRROR_PRIVATE_REPOSITORIES;
  if(mirrorPrivateRepositories === 'true' && !githubToken){
    console.error('MIRROR_PRIVATE_REPOSITORIES was set to true but no GITHUB_TOKEN was specified, please specify! Exiting..')
    return;
  }

  if(mirrorPublicRepositoriesOnly && mirrorPrivateRepositories === 'true'){
    console.log('MIRROR_PUBLIC_REPOSITORIES_ONLY is set, ignoring MIRROR_PRIVATE_REPOSITORIES.');
  }

  const githubRepositories = await getGithubRepositories(githubUsername, githubToken, mirrorPrivateRepositories, isOrg, mirrorPublicRepositoriesOnly);
  console.log(`Found ${githubRepositories.length} repositories on github`);
  await createMirrorsOnGitea(githubRepositories, githubUsername);

}

async function yamlOrg() {

  const yamlPath = process.env.YAML_URL;
  if (!yamlPath) {
    console.error('No YAML_URL specified, please specify! Exiting..');
    return;
  }

  var yamlContent = await fetch(yamlPath)
    .then(resp => resp.text())

  var doc = yaml.load(yamlContent);

  const githubToken = process.env.GITHUB_TOKEN;

  for(var org of doc.orgs) {
    const repos = []
    console.log(`Fetching org ${org}...`)
    const githubRepositories = await getGithubRepositories(org, githubToken, false, true, mirrorPublicRepositoriesOnly);
    console.log(`\tFound ${githubRepositories.length} repositories on github`);
    repos.push(...githubRepositories)
    
    await createMirrorsOnGitea(repos, org);
    console.log("waiting 60sec...")
    await delay(60000);
  }
}

let mode = "single";
const modeconfig = process.env.MIRROR_MODE;
if (modeconfig ) {
  mode = modeconfig;
}

if(mode === "single") {
  console.log("Running in single mode.")
  singleOrg();
}
else if(mode === "yaml") {
  console.log("running in yaml mode")
  yamlOrg();
}





