import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import axios from 'axios';
import os from 'os';
import dotenv from 'dotenv';
import Buffer from 'buffer';
import { getServiceByTag, getServerIpByServiceName } from "./consul.js"
import Docker from 'dockerode';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

dotenv.config();

const BufferB = Buffer.Buffer;
const privateKey = BufferB.from(process.env.GITHUB_PRIVATE_KEY, 'base64').toString('utf8');

const CONSUL_BASE_URL = "http://192.168.0.165:8500" // todo: static ip - this is the ip for the consul server
const BROADCAST_ADDR = "192.168.0.255"; // its broadcast address


import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

const appId = '890986'; 
const installationId = '50355540'; 

const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
        appId: appId,
        privateKey: privateKey,
        installationId: installationId
    }
});


const app = express();
const PORT = 3001;

app.use(express.json());



app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});



////////////////////////////////////////////////////////
////            TODO
/////////////////////////////////////////////////////////

// refactoring and some splitting of concers
// better error handling - try/catches


app.get("/health", async (req, res) => {

    res.status(200).send("deploy service is running!");
})

app.get("/destroyContainer", async (req, res) => {
    const { containerName } = req.query;

    await stopAndRemoveContainerByName(containerName)
    await deRegisterAgentService(containerName)

    const response = {
        message: `deleted container: ` + containerName
    }
    res.status(200).send(response)
})

app.get("/destroyVm", async (req, res) => {
    const { vmType, repoUrl, ownerParam, repoNameParam, lastCommitHash, redeployment, customRepoName } = req.query;

    console.log('this server received a request for vm destroy for: ',
        { vmType, repoUrl, ownerParam, repoNameParam, lastCommitHash, redeployment, customRepoName })



    let tokens = [];
    if (repoUrl) {
        tokens = repoUrl.split("/").filter(token => token !== "");
        tokens = tokens.slice(-2);
    }
    const owner = ownerParam ? ownerParam : tokens[0]
    const repoName = repoNameParam ? repoNameParam : tokens[1].slice(0, -4);
    const foldersToDelete = findFoldersWithPrefix('../vagrant', owner + "_" + repoName);


    for (const folder of foldersToDelete) {
        if (customRepoName && folder === customRepoName) continue;
        console.log("trying to destroy vm ", folder)
        const folderPath = `../vagrant/${folder}`
        const destroyVmCommand = [`cd ${folderPath}`, `echo "%cd%"`, `vagrant destroy -f`];

        await runCommand(destroyVmCommand);
        await deRegisterAgentService(folder)

        console.log("deleting folder ", folderPath)
        deleteFolder(folderPath)
    }


    const response = {
        message: `deleted all VMs for service: ` + tokens[0] + "_" + tokens[1]
    }
    res.status(200).send(response)
})




app.get("/deploy", (req, res) => {
    const {
        vmType,
        repoUrl,
        lastCommitHash,
        redeployment,
        metricsAddress,
        port,
        publicUrl,
        contractAddress
    } = req.query;

    console.log('this server received a request for deployment for: ',
        { vmType, repoUrl, lastCommitHash, redeployment, metricsAddress, port, publicUrl, contractAddress })

    const response = {
        message: `Received param1: ${vmType}, param2: ${repoUrl}, param3: ${lastCommitHash}`
    }
    res.send(response)


    setTimeout(async () => {
        console.log("Processing parameters in the background:");
        console.log(`param1: ${vmType}, param2: ${repoUrl}, param3: ${lastCommitHash}`);

        let tokens = repoUrl.split("/").filter(token => token !== "");
        tokens = tokens.slice(-2);
        const owner = tokens[0]
        const repoName = tokens[1].slice(0, -4);
        let checkRunName = "deployment check run"
        const deploymentCheckRunId = await createCheckRun(owner, repoName, lastCommitHash, checkRunName, 'in_progress')


        try {

            if (vmType === 'container') {
                await handleContainerDeploy(repoUrl, lastCommitHash, port, redeployment, metricsAddress, deploymentCheckRunId);
            } else {
                await handleVmDeploy(vmType, repoUrl, lastCommitHash, port, redeployment, metricsAddress, publicUrl, contractAddress, deploymentCheckRunId);
            }
        } catch (err) {
            await failureCheckRun(owner, repoName, deploymentCheckRunId)
        }


    }, 0);
});

const handleContainerDeploy = async (repoUrl, lastCommitHash, port, redeployment, metricsAddress, deploymentCheckRunId) => {
    let tokens = repoUrl.split("/").filter(token => token !== "");
    tokens = tokens.slice(-2);
    const owner = tokens[0]
    const repoName = tokens[1].slice(0, -4);
    let checkRunName = "deployment check run"
    if (redeployment && redeployment === true) {
        checkRunName = "redeployment"
    }
    const customRepoName = owner + "_" + repoName + "_" + lastCommitHash
    const foldersToDelete = findFoldersWithPrefix('../vagrant', owner + "_" + repoName);
    const hostName = customRepoName.replace(/_/g, '-')

    console.log("------------------------------------------------------");
    console.log("hostname = ", hostName);
    console.log("------------------------------------------------------");



    let bridge = "";
    let serverIp = "";
    if (os.platform() === 'win32') {
        // its a requirement that servers run on linux
        bridge = "";
    } else {
        const getNetInferfaceNameCommand = `ip -4 addr | grep -B2 "brd ${BROADCAST_ADDR}" | grep -oP '^\\d: \\K[^:]+'`
        bridge = await netInfCommand(getNetInferfaceNameCommand)
        bridge = bridge.trim()
        serverIp = await netInfCommand(`ip addr show ${bridge} | grep 'inet ' | awk '{print $2}' | cut -d/ -f1`)
    }




    await updateCheckRun(owner, repoName, deploymentCheckRunId, 'in_progress')
    await updateCheckRun(owner, repoName, deploymentCheckRunId, 'in_progress')
    const containerName = customRepoName
    const image = "beiuhori07/integrity-check"
    const hostPort = await runContainer(image, containerName, port);
    console.log("FINISHED STARTING THE CONTAINER")

    let publicURL = "there was an issue while exposing the app publicly";
    if (hostPort) {

        await netInfCommand(`(nohup ssh -t -t -o StrictHostKeyChecking=no -R 80:localhost:${hostPort} serveo.net  > ./serveo_output.log 2>&1 &)`)
        for (let i = 1; i < 20; i++) {
            publicURL = findPublicUrl('./serveo_output.log')
            if (publicURL) break;
            await sleep(1000);
        }
        console.log("public url", publicURL)
    } 

    await completeCheckRun(owner, repoName, deploymentCheckRunId, publicURL + "/log-timestamp")
    await completeCheckRun(owner, repoName, deploymentCheckRunId, publicURL + "/log-timestamp")
    const serviceToRegister = {
        Name: customRepoName,
        Address: publicURL,
        Port: parseInt(port),
        Tags: ["app", "container", "app-container"],
        Meta: {
            metricsAddress: metricsAddress,
            hostName: hostName,
            serverIp: serverIp
        },
        Check: {
            HTTP: `${publicURL}/health`,
            Interval: "20s",
            Timeout: "5s"
        }
    }
    await registerAgentService(serviceToRegister)

    for (const folder of foldersToDelete) {
        console.log("trying to destroy vm ", folder)
        const folderPath = `../vagrant/${folder}`
        const destroyVmCommand = [`cd ${folderPath}`, `echo "%cd%"`, `vagrant destroy -f`];

        await runCommand(destroyVmCommand);
        await deRegisterAgentService(folder)

        console.log("deleting folder ", folderPath)
        deleteFolder(folderPath)
    }

    const registeredVMAppsObject = await getServiceByTag("app-vm");
    const registeredVMApps = Object.keys(registeredVMAppsObject);
    const previousVMVersionsOnOtherServers = registeredVMApps.filter(app => app.startsWith(owner + "_" + repoName) && app !== customRepoName)

    for (const prevVMVersionName of previousVMVersionsOnOtherServers) {
        const prevVersionServerIp = await getServerIpByServiceName(prevVMVersionName)

        if (prevVersionServerIp.serverIp) {

            const destroyParams = {
                ownerParam: owner,
                repoNameParam: repoName
            }
            console.log("about to make vm destroy call at ", prevVersionServerIp.serverIp)
            const data = await destroy(`http://${prevVersionServerIp.serverIp}:3001/destroyVm`, destroyParams)
        }

    }

    const registeredContainerAppsObject = await getServiceByTag("app-container");
    const registeredContainerApps = Object.keys(registeredContainerAppsObject);
    const previousContainerVersionsOnOtherServers = registeredContainerApps.filter(app => app.startsWith(owner + "_" + repoName) && app !== customRepoName)

    for (const prevContainerVersionName of previousContainerVersionsOnOtherServers) {
        const prevVersionServerIp = await getServerIpByServiceName(prevContainerVersionName)

        if (prevVersionServerIp.serverIp) {

            const destroyParams = {
                containerName: prevContainerVersionName
            }
            console.log("about to make container destroy call at ", prevVersionServerIp.serverIp)
            const data = await destroy(`http://${prevVersionServerIp.serverIp}:3001/destroyContainer`, destroyParams)

        }

    }
}

const handleVmDeploy = async (vmType, repoUrl, lastCommitHash, port, redeployment, metricsAddress, blockchainPublicUrl, contractAddress, deploymentCheckRunId) => {

    let tokens = repoUrl.split("/").filter(token => token !== "");
    tokens = tokens.slice(-2);
    const owner = tokens[0]
    const repoName = tokens[1].slice(0, -4);
    let checkRunName = "deployment check run"
    if (redeployment && redeployment === true) {
        checkRunName = "redeployment"
    }
    const customRepoName = owner + "_" + repoName + "_" + lastCommitHash
    const foldersToDelete = findFoldersWithPrefix('../vagrant', owner + "_" + repoName);
    const customPath = path.join("../vagrant", customRepoName);
    createFolderSync(customPath)


    const hostName = customRepoName.replace(/_/g, '-')

    console.log("------------------------------------------------------");
    console.log("hostname = ", hostName);
    console.log("------------------------------------------------------");


    let bridge = "";
    let serverIp = "";
    if (os.platform() === 'win32') {
        // servers should run on linux
        bridge = "";
    } else {
        const getNetInferfaceNameCommand = `ip -4 addr | grep -B2 "brd ${BROADCAST_ADDR}" | grep -oP '^\\d: \\K[^:]+'`
        bridge = await netInfCommand(getNetInferfaceNameCommand)
        bridge = bridge.trim()
        serverIp = await netInfCommand(`ip addr show ${bridge} | grep 'inet ' | awk '{print $2}' | cut -d/ -f1`)
    }


    const configData = {
        port: port,
        repoName: hostName,
        repoUrl: repoUrl,
        vmType: vmType,
        bridge: bridge,
        blockchainPublicUrl: blockchainPublicUrl,
        contractAddress: contractAddress
    };

    console.log('configData', configData)
    const fileName = "config.json";
    const filePath = path.join(customPath, fileName);
    createJsonFile(filePath, configData)




    let templateSrcPath;

    if (vmType === "cpu") {
        templateSrcPath = "../vagrant/Vagrantfile_template_cpu"
    } else {
        templateSrcPath = "../vagrant/Vagrantfile_template_memory"
    }
    const templateDestPath = path.join(customPath, "Vagrantfile")
    await copyFile(templateSrcPath, templateDestPath)




    await updateCheckRun(owner, repoName, deploymentCheckRunId, 'in_progress')
    const runVagrantFileCommand = [`cd ${customPath}`, `echo "%cd%"`, `vagrant up`];
    const publicURL = await runCommand(runVagrantFileCommand);
    console.log(publicURL)
    await completeCheckRun(owner, repoName, deploymentCheckRunId, publicURL + "/log-timestamp")
    const serviceToRegister = {
        Name: customRepoName,
        Address: publicURL,
        Port: parseInt(port),
        Tags: ["app", "vm", "app-vm"],
        Meta: {
            metricsAddress: metricsAddress,
            hostName: hostName,
            serverIp: serverIp
        },
        Check: {
            HTTP: `${publicURL}/health`,
            Interval: "20s",
            Timeout: "5s"
        }
    }
    await registerAgentService(serviceToRegister)



    for (const folder of foldersToDelete) {
        console.log("trying to destroy vm ", folder)
        const folderPath = `../vagrant/${folder}`
        const destroyVmCommand = [`cd ${folderPath}`, `echo "%cd%"`, `vagrant destroy -f`];

        await runCommand(destroyVmCommand);
        await deRegisterAgentService(folder)

        console.log("deleting folder ", folderPath)
        deleteFolder(folderPath)
    }

    const registeredAppsObject = await getServiceByTag("app-vm");
    const registeredApps = Object.keys(registeredAppsObject);
    const previousVersionsOnOtherServers = registeredApps.filter(app => app.startsWith(owner + "_" + repoName) && app !== customRepoName)

    for (const prevVersionName of previousVersionsOnOtherServers) {
        const prevVersionServerIp = await getServerIpByServiceName(prevVersionName)

        if (prevVersionServerIp.serverIp) {

            const destroyParams = {
                ownerParam: owner,
                repoNameParam: repoName,
                customRepoName: customRepoName  
            }
            console.log("about to make destroy call at ", prevVersionServerIp.serverIp)
            const data = await destroy(`http://${prevVersionServerIp.serverIp}:3001/destroyVm`, destroyParams)
        }

    }
    const registeredContainerAppsObject = await getServiceByTag("app-container");
    const registeredContainerApps = Object.keys(registeredContainerAppsObject);
    const previousContainerVersionsOnOtherServers = registeredContainerApps.filter(app => app.startsWith(owner + "_" + repoName) && app !== customRepoName)

    for (const prevContainerVersionName of previousContainerVersionsOnOtherServers) {
        const prevVersionServerIp = await getServerIpByServiceName(prevContainerVersionName)

        if (prevVersionServerIp.serverIp) {

            const destroyParams = {
                containerName: prevContainerVersionName
            }
            console.log("about to make container destroy call at ", prevVersionServerIp.serverIp)
            const data = await destroy(`http://${prevVersionServerIp.serverIp}:3001/destroyContainer`, destroyParams)

        }

    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function stopAndRemoveContainerByName(containerName) {
    try {
        const containers = await docker.listContainers({ all: true });
        const containerInfo = containers.find(c => c.Names.some(name => name === `/${containerName}`));

        if (!containerInfo) {
            console.log('Container not found!');
            return;
        }

        const container = docker.getContainer(containerInfo.Id);

        if (containerInfo.State === "running") {
            await container.stop();
            console.log('Container stopped:', containerName);
        }

        await container.remove({ force: true });
        console.log('Container removed:', containerName);
    } catch (error) {
        console.error('Error stopping/removing container:', error);
        throw error;
    }
}

async function runContainer(image, containerName, port) {
    return new Promise((resolve, reject) => {
        docker.pull(image, (err, stream) => {
            if (err) {
                console.error('Error pulling image:', err);
                reject(err);
                return;
            }

            docker.modem.followProgress(stream, onFinished, onProgress);

            function onFinished(err, output) {
                if (err) {
                    console.error('Error pulling image:', err);
                    reject(err);
                    return;
                }

                docker.createContainer({
                    Image: image,
                    name: containerName,
                    Tty: true,
                    ExposedPorts: { [`${port}/tcp`]: {} },
                    HostConfig: {
                        PortBindings: {
                            [`${port}/tcp`]: [{}]  // Empty object lets Docker assign a random host port
                        }
                    }
                }, (err, container) => {
                    if (err) {
                        console.error('Error creating container:', err);
                        reject(err);
                        return;
                    }

                    container.start(async (err, data) => {
                        if (err) {
                            console.error('Error starting container:', err);
                            reject(err);
                            return;
                        }

                        console.log('Container started successfully:', data);

                        try {
                            const containerData = await container.inspect();
                            const hostPort = containerData.NetworkSettings.Ports[`${port}/tcp`][0].HostPort;
                            console.log(`Nginx is available at http://localhost:${hostPort}`);
                            resolve(hostPort);
                        } catch (inspectError) {
                            console.error('Error inspecting container:', inspectError);
                            reject(inspectError);
                        }
                    });
                });
            }

            function onProgress(event) {
                console.log('Pulling image progress:', event);
            }
        });
    });
}



export async function destroy(baseUrl, params) {
    const queryString = new URLSearchParams(params).toString();
    const urlWithParams = `${baseUrl}?${queryString}`;

    try {
        const response = await fetch(urlWithParams);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Parse the JSON response
        // const data = response.body
        const data = await response.json();
        console.log('Success:', data);
        return data;
    } catch (error) {
        console.error('Error:', error);
    }
}






function createFolderSync(folderName) {
    try {
        if (!fs.existsSync(folderName)) {
            fs.mkdirSync(folderName);
            console.log(`Folder "${folderName}" created successfully.`);
        } else {
            console.log(`Folder "${folderName}" already exists.`);

        }
    } catch (err) {
        console.error("An error occurred while creating the folder:", err);
        throw err
    }
}

function findPublicUrl(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const regex = new RegExp(/https:\/\/.*\.serveo\.net/);
    const match = content.match(regex);

    return match ? match[0] : null;
}

function createJsonFile(filePath, data) {
    try {
        const jsonString = JSON.stringify(data, null, 2);

        fs.writeFileSync(filePath, jsonString);

        console.log(`File "${filePath}" created successfully.`);
    } catch (err) {
        console.error("An error occurred while creating the JSON file:", err);
        throw err
        // todo: run the check run status as failed heree
    }
}

function copyFile(srcPath, destPath) {
    return new Promise((resolve, reject) => {

        fs.copyFile(srcPath, destPath, (err) => {
            if (err) {
                console.error("An error occurred while copying the file:", err);

                reject(err);

            } else {
                console.log(`File copied from "${srcPath}" to "${destPath}" successfully.`);
                resolve();
            }
        });
    });
}


function netInfCommand(command) {
    return new Promise((resolve, reject) => {
        const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
        const shellArgs = os.platform() === 'win32' ? ['/c'] : ['-c'];
        // const formattedCommand = os.platform() === 'win32' ? commands.join(' && ') : commands.join(' ; ');

        const child = spawn(shell, [...shellArgs, command]);


        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
            process.stdout.write(`stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
            stderrData += data.toString();
            process.stderr.write(`stderr: ${data}`);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                const errorMessage = `Command failed with code ${code}`;
                console.error(errorMessage);
                reject(errorMessage);
                return;
            }

            if (stderrData) {
                console.error('Command error output:', stderrData);
                reject(stderrData);
                return;
            }

            resolve(stdoutData)
        })

        child.on('error', (error) => {
            console.error('An error occurred while running the command:', error.message);
            reject(error.message);
        });
    })
}

function runCommand(commands) {
    return new Promise((resolve, reject) => {
        const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
        const shellArgs = os.platform() === 'win32' ? ['/c'] : ['-c'];
        const formattedCommand = os.platform() === 'win32' ? commands.join(' && ') : commands.join(' ; ');


        const child = spawn(shell, [...shellArgs, formattedCommand]);

        let stdoutData = '';
        let stderrData = '';

        child.stdout.on('data', (data) => {
            stdoutData += data.toString();
            process.stdout.write(`stdout: ${data}`);
        });

        child.stderr.on('data', (data) => {
            stderrData += data.toString();
            process.stderr.write(`stderr: ${data}`);
        });

        child.on('close', (code) => {
            if (code !== 0) {
                const errorMessage = `Command failed with code ${code}`;
                console.error(errorMessage);
                reject(errorMessage);
                return;
            }

            if (stderrData) {
                console.error('Command error output:', stderrData);
                reject(stderrData);
                return;
            }

            const outputLines = stdoutData.trim().split('\n');
            const lastTenLines = outputLines.slice(-10);

            const urlRegex = /https:\/\/.*\.serveo\.net/;
            const urlLine = lastTenLines.find(line => urlRegex.test(line));

            if (urlLine) {
                const url = urlLine.match(urlRegex)[0];
                console.log('URL = ', url);
                resolve(url);
            } else {
                const errorMessage = "No URL matching the pattern 'https://.*.serveo.net' found.";
                console.error(errorMessage);
                resolve(errorMessage);
            }
        });

        child.on('error', (error) => {
            console.error('An error occurred while running the command:', error.message);
            reject(error.message);
        });
    });
}


function findFoldersWithPrefix(directory, prefix) {
    try {
        const items = fs.readdirSync(directory);

        const matchingDirs = items.filter(item => {
            const itemPath = path.join(directory, item);

            return fs.lstatSync(itemPath).isDirectory() && item.startsWith(prefix);
        });

        console.log('Matching directories:', matchingDirs);
        return matchingDirs
    } catch (err) {
        console.error('Error reading directory:', err);
        return []
    }
}

const deleteFolder = pathToFolder => {

    fs.rm(pathToFolder, { recursive: true, force: true }, (err) => {
        if (err) {
            console.error('Error deleting folder:', err);
        } else {
            console.log('Folder and its contents deleted successfully.');
        }
    });

}



async function createCheckRun(owner, repo, head_sha, name, status) {
    try {
        const response = await octokit.checks.create({
            owner: owner,
            repo: repo,
            name: name,
            head_sha: head_sha,
            status: status,
            started_at: new Date(),
            output: {
                title: 'Check Run Started',
                summary: 'The check run has started successfully!',
                text: 'Details of the check run here...'
            }
        });

        console.log('Check Run created successfully');
        console.log('check run id ', response.data.id);


        return response.data.id
    } catch (error) {
        console.error('Error creating Check Run:', error);
    }
}


async function updateCheckRun(owner, repo, check_run_id, new_status) {

    console.log('about to update check run to status: ', new_status)
    try {
        const response = await octokit.checks.update({
            owner: owner,
            repo: repo,
            check_run_id: check_run_id,
            status: new_status,
        });

        console.log('Check Run updated successfully - status: ', response.data.status);
    } catch (error) {
        console.error('Error updating Check Run:', error);
    }
}

async function failureCheckRun(owner, repo, check_run_id) {

    console.log('about to update check run to status: failure')
    try {
        const response = await octokit.checks.update({
            owner: owner,
            repo: repo,
            check_run_id: check_run_id,
            completed_at: new Date(),
            conclusion: 'failure',
            output: {
                title: "Deployment",
                summary: "deployment failed",
                text: "an error occured in the process"
            }
        });

        console.log('Check Run updated successfully - status: ', response.data.status);
    } catch (error) {
        console.error('Error updating Check Run:', error);
    }
}

async function completeCheckRun(owner, repo, check_run_id, message) {

    try {
        const response = await octokit.checks.update({
            owner: owner,
            repo: repo,
            check_run_id: check_run_id,
            status: 'completed',
            completed_at: new Date(),
            conclusion: 'success',
            output: {
                title: "Deployment",
                summary: "deployment complete",
                text: message
            }
        });

        console.log('Check Run updated successfully - status: ', response.data.status);
    } catch (error) {
        console.error('Error updating Check Run:', error);
    }
}


async function registerAgentService(requestBody) {
    try {
        console.log("trying to register a new service on agent...")
        const response = await axios.put(`${CONSUL_BASE_URL}/v1/agent/service/register?replace-existing-check=true`,
            requestBody,
            {
                headers: {
                    'Content-Type': 'application/json',
                }
            }
        );
        console.log('response status:', response.status);
        console.log('response data:', response.data);

        return true;
    } catch (error) {
        console.error('Error fetching services:', error);
        throw error;
    }
}

async function deRegisterAgentService(serviceName) {
    try {
        console.log("trying to DEregister a service on agent...")
        const response = await axios.put(`${CONSUL_BASE_URL}/v1/agent/service/deregister/${serviceName}`,
            {},
            {}
        );
        console.log('response status:', response.status);
        console.log('response data:', response.data);

        return true;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.error("Service already not registered (404).");
        } else {
            console.error("Error making PUT request:", error.message);
            // throw error;
        }
    }
}
