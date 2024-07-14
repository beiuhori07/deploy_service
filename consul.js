import axios from 'axios';


const CONSUL_BASE_URL = 'http://localhost:8500/v1'; // Change to your Consul server URL if needed


async function getCatalogNodes() {
    try {
        const response = await axios.get(`${CONSUL_BASE_URL}/catalog/nodes`);
        console.log('Nodes:', response.data);
    } catch (error) {
        console.error('Error fetching nodes:', error);
    }
}

async function getServices() {
    try {
        const response = await axios.get(`${CONSUL_BASE_URL}/catalog/services`);
        console.log('Services:', response.data);
    } catch (error) {
        console.error('Error fetching services:', error);
    }
}

export async function getServiceNodes(serviceName) {
    try {
        const response = await axios.get(`${CONSUL_BASE_URL}/catalog/service/${serviceName}`);
        // console.log('Services:', response.data);

        return response.data
    } catch (error) {
        console.error('Error fetching services:', error);
    }
}

export async function getServiceByTag(tag) {
    try {
        const response = await axios.get(`${CONSUL_BASE_URL}/catalog/services?filter= "${tag}" in ServiceTags`); // goofy ahh api
        // console.log('Services:', response.data);

        return response.data
    } catch (error) {
        console.error('Error fetching services:', error);
    }
}


export async function getNodes(serviceName) {
    try {
        const response = await axios.get(`${CONSUL_BASE_URL}/health/service/${serviceName}`);
        // console.log('Services:', response.data);

        let hosts = []
        response.data.forEach(service => {
            hosts.push(
                {
                    hostname: service.Node.Node,
                    checks: service.Checks,
                    geolocation: service.Service.Meta.geolocation,
                    ip: service.Node.Address
                }
            )
        })

        console.log("hosts = ", hosts)
        return hosts;
    } catch (error) {
        console.error('Error fetching services:', error);
    }
}

export async function getServerIpByServiceName(serviceName) {
    try {
        const response = await axios.get(`${CONSUL_BASE_URL}/health/service/${serviceName}`);
        // console.log('Services:', response.data);

        let hosts = []
        response.data.forEach(service => {

            // const httpCheck = service.Checks.find(check => check.CheckID === `service:${serviceName}`)

            hosts.push({
                serverIp: service.Service.Meta.serverIp
            })
        })

        console.log("hosts = ", hosts)
        return hosts.length > 0 ? hosts[0] : [];
    } catch (error) {
        console.error('Error fetching services:', error);
    }
}


export async function getAppVmHostNameByServiceName(serviceName) {
    try {
        const response = await axios.get(`${CONSUL_BASE_URL}/health/service/${serviceName}`);
        // console.log('Services:', response.data);

        let hosts = []
        response.data.forEach(service => {
            if (service.Service.Meta && service.Service.Meta.hostName && service.Service.Meta.metricsAddress) {
                hosts.push({ 
                    hostName: service.Service.Meta.hostName,
                    metricsAddress: service.Service.Meta.metricsAddress
                })
            }
        })

        console.log("hosts = ", hosts)
        return hosts.length > 0 ? hosts[0] : [];
    } catch (error) {
        console.error('Error fetching services:', error);
    }
}