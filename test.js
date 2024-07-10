import  { spawn } from 'child_process';
import os from 'os';

function runCommand(command) {
    return new Promise((resolve, reject) => {
        // Determine the shell and format command based on the OS
        const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/sh';
        const shellArgs = os.platform() === 'win32' ? ['/c'] : ['-c'];
        const formattedCommand = os.platform() === 'win32' ? command : `"${command}"`;

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


// console.log(os.platform())
// console.log(os.cpus()[0])
// console.log(os.cpus().length)
// console.log(os.networkInterfaces())

// runCommand("ipconfig")


import Docker from 'dockerode';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

async function runContainer() {
  try {
    // Pull the image (if not already available)
    await docker.pull('nginx', (err, stream) => {
      if (err) {
        console.error('Error pulling image:', err);
        return;
      }

      docker.modem.followProgress(stream, onFinished, onProgress);

      function onFinished(err, output) {
        if (err) {
          console.error('Error pulling image:', err);
          return;
        }

        // Create and start the container with a dynamic host port
        docker.createContainer({
          Image: 'nginx',
        //   name: 'my-nginx-container',
          Tty: true,
          ExposedPorts: { '80/tcp': {} },
          HostConfig: {
            PortBindings: {
              '80/tcp': [{}]  // Empty object lets Docker assign a random host port
            }
          }
        }, (err, container) => {
          if (err) {
            console.error('Error creating container:', err);
            return;
          }

          container.start(async (err, data) => {
            if (err) {
              console.error('Error starting container:', err);
              return;
            }

            console.log('Container started successfully:', data);

            // Inspect the container to find the allocated host port
            const containerData = await container.inspect();
            const hostPort = containerData.NetworkSettings.Ports['80/tcp'][0].HostPort;
            console.log(`Nginx is available at http://localhost:${hostPort}`);
          });
        });
      }

      function onProgress(event) {
        console.log('Pulling image progress:', event);
      }
    });
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the function to start the container and get the host port
runContainer();
