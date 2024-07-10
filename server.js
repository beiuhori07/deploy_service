import express from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import axios from 'axios';
import os from 'os';
import dotenv from 'dotenv';
import Buffer from 'buffer';

dotenv.config();

const BufferB = Buffer.Buffer;
const privateKey = BufferB.from(process.env.GITHUB_PRIVATE_KEY, 'base64').toString('utf8');

// todo:
// is this enough this way
// only this case 8501 - in general 8500
const CONSUL_BASE_URL = "http://192.168.0.165:8500" // todo: static ip - read it somehow?
const BROADCAST_ADDR = "192.168.0.255";

// todo: add the apikeys to .env and read/pass them to the config file



import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

const appId = '890986'; // Replace with your GitHub App's ID
const installationId = '50355540'; // Replace with installation ID for the repository

// Create a new instance of Octokit with GitHub App authentication
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



// error/failure check-run update on exceptions thrown



// cleanup pipeline script
// better error handling - try/catches



// todo: redeployment async/await not working - deployments may start before the whole destruction of vms

app.get("/health", async (req, res) => {

    res.status(200).send("deploy service is running!");
})

app.get("/destroyVm", async (req, res) => {
    const { vmType, repoUrl, lastCommitHash, redeployment } = req.query;

    console.log('this server received a request for deployment for: ',
        { vmType, repoUrl, lastCommitHash, redeployment })

    

    let tokens = repoUrl.split("/").filter(token => token !== "");
    tokens = tokens.slice(-2);
    const owner = tokens[0]
    const repoName = tokens[1].slice(0, -4);
    // const deploymentCheckRunId = await createCheckRun(owner, repoName, lastCommitHash, "deployment check run", 'in_progress')
    const foldersToDelete = findFoldersWithPrefix('../vagrant', owner + "_" + repoName);


    for (const folder of foldersToDelete) {
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
    // todo: geolocation
    const { 
        vmType,
        repoUrl,
        lastCommitHash,
        redeployment,
        metricsAddress,
        port
    } = req.query;

    console.log('this server received a request for deployment for: ',
        { vmType, repoUrl, lastCommitHash, redeployment, metricsAddress, port })

    const response = {
        message: `Received param1: ${vmType}, param2: ${repoUrl}, param3: ${lastCommitHash}`
    }
    res.send(response)


    setTimeout(async () => {
        console.log("Processing parameters in the background:");
        console.log(`param1: ${vmType}, param2: ${repoUrl}, param3: ${lastCommitHash}`);



        // check if a folder exists - to delete it later after new one is up and running

        let tokens = repoUrl.split("/").filter(token => token !== "");
        tokens = tokens.slice(-2);
        const owner = tokens[0]
        const repoName = tokens[1].slice(0, -4);
        let checkRunName = "deployment check run"
        if(redeployment && redeployment === true) {
            checkRunName = "redeployment"
        }
        const deploymentCheckRunId = await createCheckRun(owner, repoName, lastCommitHash, checkRunName, 'in_progress')
        const customRepoName = owner + "_" + repoName + "_" + lastCommitHash
        const foldersToDelete = findFoldersWithPrefix('../vagrant', owner + "_" + repoName);
        const customPath = path.join("../vagrant", customRepoName);
        createFolderSync(customPath)





        // copy template config files there? actually create them and include the vmtype and repourl in the config.json

        const hostName = customRepoName.replace(/_/g, '-')

        console.log("------------------------------------------------------");
        console.log("hostname = ", hostName);
        console.log("------------------------------------------------------");
        

        let bridge = "";
        // todo: to test on both oses
        if(os.platform() === 'win32') {
            //todo: find the command for cmd as well
            //atm it works like this but not really safe
            bridge = "";
        } else {
            const getNetInferfaceNameCommand = `ip -4 addr | grep -B2 "brd ${BROADCAST_ADDR}" | grep -oP '^\\d: \\K[^:]+'` 
            bridge = await netInfCommand(getNetInferfaceNameCommand)
            bridge = bridge.trim()
        }


        const configData = {
            port: port,
            repoName: hostName,
            repoUrl: repoUrl,
            vmType: vmType,
            bridge: bridge
        };

        console.log('configData', configData)
        const fileName = "config.json";
        const filePath = path.join(customPath, fileName);
        createJsonFile(filePath, configData)


        // then actually copy the template for a vagrantfile of the given vm type


        let templateSrcPath;

        if (vmType === "cpu") {
            templateSrcPath = "../vagrant/Vagrantfile_template_cpu"
        } else {
            templateSrcPath = "../vagrant/Vagrantfile_template_memory"
        }
        const templateDestPath = path.join(customPath, "Vagrantfile")
        await copyFile(templateSrcPath, templateDestPath)


        // run the vagrantfile


        await updateCheckRun(owner, repoName, deploymentCheckRunId, 'in_progress')
        const runVagrantFileCommand = [`cd ${customPath}`, `echo "%cd%"`, `vagrant up`];
        const publicURL = await runCommand(runVagrantFileCommand);
        console.log(publicURL)
        await completeCheckRun(owner, repoName, deploymentCheckRunId, publicURL + "/log-timestamp")
        const serviceToRegister = {
            Name: customRepoName,
            Address: publicURL,
            Port: parseInt(port),
            Tags: ["app"],
            Meta: {
                metricsAddress: metricsAddress, 
                hostName: hostName
            },
            Check: {
                HTTP: `${publicURL}/health`,
                Interval: "10s",
                Timeout: "1s"
            }
        }
        await registerAgentService(serviceToRegister)



        // todo: kill ruby process in case it remains up? vagrant bug?
        for (const folder of foldersToDelete) {
            console.log("trying to destroy vm ", folder)
            const folderPath = `../vagrant/${folder}`
            const destroyVmCommand = [`cd ${folderPath}`, `echo "%cd%"`, `vagrant destroy -f`];

            await runCommand(destroyVmCommand);
            await deRegisterAgentService(folder)

            console.log("deleting folder ", folderPath)
            deleteFolder(folderPath)
        }



    }, 0);
});






function createFolderSync(folderName) {
    try {
        if (!fs.existsSync(folderName)) {
            fs.mkdirSync(folderName);
            console.log(`Folder "${folderName}" created successfully.`);
        } else {
            console.log(`Folder "${folderName}" already exists.`);

            // todo: run the check run status as failed here 
            // todo: maybe a big exception wrapper for the failed case? 
        }
    } catch (err) {
        console.error("An error occurred while creating the folder:", err);

        // todo: run the check run status as failed here
    }
}


function createJsonFile(filePath, data) {
    try {
        const jsonString = JSON.stringify(data, null, 2);

        fs.writeFileSync(filePath, jsonString);

        console.log(`File "${filePath}" created successfully.`);
    } catch (err) {
        console.error("An error occurred while creating the JSON file:", err);

        // todo: run the check run status as failed heree
    }
}

function copyFile(srcPath, destPath) {
    return new Promise((resolve, reject) => {

        fs.copyFile(srcPath, destPath, (err) => {
            if (err) {
                console.error("An error occurred while copying the file:", err);

                // todo: run the check run status as failed heree
                reject(err);  // Reject the promise on error

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

// todo: test also on linux servers
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
            const lastTenLines = outputLines.slice(-40);

            const urlRegex = /https:\/\/.*\.lhr\.life/;
            const urlLine = lastTenLines.find(line => urlRegex.test(line));

            if (urlLine) {
                const url = urlLine.match(urlRegex)[0];
                console.log('URL = ', url);
                resolve(url);
            } else {
                const errorMessage = "No URL matching the pattern 'https://.*.lhr.life' found.";
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
        // console.log('check run creation response ', response.data);
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
