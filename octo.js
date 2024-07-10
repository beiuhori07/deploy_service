import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import dotenv from 'dotenv';
import Buffer from 'buffer';

dotenv.config();

const BufferB = Buffer.Buffer;
const privateKey = BufferB.from(process.env.GITHUB_PRIVATE_KEY, 'base64').toString('utf8');
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
async function createCheckRun(owner, repo, head_sha, name, status) {
    try {
        const response = await octokit.checks.create({
            owner: owner,
            repo: repo,
            name: name,
            head_sha: head_sha,
            status: status,
            started_at: new Date(),
            // conclusion: "neutral",
            output: {
                title: 'Check Run Complete',
                summary: 'The check run has completed successfully!',
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

        console.log('Check Run updated successfully:', response.data);
    } catch (error) {
        console.error('Error updating Check Run:', error);
    }
}

async function completeCheckRun(owner, repo, check_run_id) {

    try {
        const response = await octokit.checks.update({
            owner: owner,
            repo: repo,
            check_run_id: check_run_id,
            status: 'completed',
            completed_at: new Date(),
            conclusion: 'success'
        });

        console.log('Check Run updated successfully:', response.data);
    } catch (error) {
        console.error('Error updating Check Run:', error);
    }
}

// Example usage
// const checkId = createCheckRun('beiuhori07', 'integrity-check', '27e5209f13a4f5e0245db64988c5f2ccd8a7092f', "test check", "queued");

// updateCheckRun('beiuhori07', 'integrity-check', "24590981015", 'in_progress');
// updateCheckRun('beiuhori07', 'integrity-check', "24590981015", 'completed');
completeCheckRun('beiuhori07', 'integrity-check', "24590981015");


