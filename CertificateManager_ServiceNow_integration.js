//This code needs to work as a cloud function, and it will monitor the event "cert_renewed" of the certificates in Certificate Manager, once detects the cert has been auto-renewed
//it will create a servicenow change request.

//Prerequisites:  need to set "sn_token" to the servicenow token as a "parameter" in cloud function, before enabling/running this cloud function code

const {promisify} = require('bluebird');
const request = promisify(require('request'));
const jwtVerify = promisify(require('jsonwebtoken').verify);
const axios = require('axios')

//servicenow change request related statement
const baseURL = 'https://watson.service-now.com/api/ibmwc/change'
const sn_cr_assigned_to_person = 'cran@us.ibm.com'
const sn_cr_system = 'wfss-fci'
const sn_cr_outageduration = '0 00:00:00'
const sn_cr_priority = 'planning'
const sn_cr_env = 'WFSS SaaS'
const sn_cr_backoutplan = 'roll back and deploy the old certificates'
const sn_cr_deploymentready = 'no'
const sn_cr_type = 'standard'
//set the planned start time and planned end time to 10 days after the current time
var now = new Date();
//set change request planned start and end time to 10 days after current time
var new_date = new Date();
new_date.setDate(now.getDate()+10);
var sn_cr_plannedstart =  new_date.getFullYear() + "-" + ("0"+(new_date.getMonth()+1)).slice(-2) + "-" + ("0" + new_date.getDate()).slice(-2) + " " + ("0" + new_date.getHours()).slice(-2) + ":" + ("0" + new_date.getMinutes()).slice(-2) + ":" + ("0" + new_date.getSeconds()).slice(-2);
var sn_cr_plannedend = new_date.getFullYear() + "-" + ("0"+(new_date.getMonth()+1)).slice(-2) + "-" + ("0" + new_date.getDate()).slice(-2) + " " + ("0" + new_date.getHours()).slice(-2) + ":" + ("0" + new_date.getMinutes()).slice(-2) + ":" + ("0" + new_date.getSeconds()).slice(-2);

//certificate related constants
const os_cert_domain = '*.regtech.cloud.ibm.com'
//Only for test purpose
//const os_cert_domain = 'appdomain.com'

//environments that contain Let's encrypt certificate
const envs = ['erie3', 'erie4'];



//get publickey that can be used to communicate with Certificate Manager
async function getPublicKey() {
    const keysOptions = {
        method: 'GET',
        url: `https://us-south.certificate-manager.cloud.ibm.com/api/v1/instances/crn%3Av1%3Abluemix%3Apublic%3Acloudcerts%3Aus-south%3Aa%2F055a5e2f37fb7f7e380dd348269f1282%3A88f818af-db46-4fc3-9cac-6679d2ecaeea%3A%3A/notifications/publicKey?keyFormat=pem`,
        headers: {
            'cache-control': 'no-cache'
        }
    };
    const keysResponse = await request(keysOptions);
    return JSON.parse(keysResponse.body).publicKey;
}

function getDate(timestamp) {
    return new Date(timestamp).toDateString();
}

async function main(params) {
    try {
        const sn_token = params.sn_token;
        const publicKey = await getPublicKey();
        const decodedNotification = await jwtVerify(params.data, publicKey);
        console.log(`Notification: ${JSON.stringify(decodedNotification)}`);
        console.log(`sn token is ${sn_token}`);
        var certificate_manager_url = decodedNotification.certificate_manager_url;
        //only for test purpose
        //if (decodedNotification.event_type === "cert_reimported" || decodedNotification.event_type === "cert_about_to_expire_renew_required" || decodedNotification.event_type === "cert_about_to_expire_reimport_required") {
        if (decodedNotification.event_type === "cert_renewed" || decodedNotification.event_type === "cert_renew_failed") {
            for (var i = 0; i < decodedNotification.certificates.length; i++) {
                var cert_domain = decodedNotification.certificates[i].domains;
                
                if (decodedNotification.event_type === "cert_renewed") {
                    console.log(`certificate ${cert_domain} has been auto-renewed in IBM Cloud Certificate Manager, Need to trigger the cert deployment in next 30 days`);
                } else {
                    console.log(`certificate ${cert_domain} failed to be auto-renewed in IBM Cloud Certificate Manager, Need to manually renew it, and trigger the cert renewal/deployment in the corresponding environment in next 30 days`);
                    //FIXME an TODO:  Need to notify via slack channel and pagerduty when certificate failed to be renewed.
                }
                var impact_cr = '';
                var purpose_cr = '';
                var description_cr = '';
                //if cert is an openshift cert, which domain is "*.regtech.cloud.ibm.com"
                if (cert_domain === `${os_cert_domain}`) {
                    impact_cr = 'Openshift portal will be unavailable for the period of the maintenance window.'
                    //if it's openshift domain cert "*.regtech.cloud.ibm.com", we need to create separate change request for different env
                    for (env_cert_to_be_updated of envs) {
                        if (decodedNotification.event_type === "cert_renew_failed") {
                            purpose_cr = `Auto-renewal for openshift domain certificate ${os_cert_domain} failed in IBM Cloud Certificate Manager, so need to issue new Let\'s encrypt cert for ${os_cert_domain},  import these new certs to $ {certificate_manager_url}, and then deploy these certs to the corresponding environment`
                            description_cr = `For environment ${env_cert_to_be_updated}, do following steps: 1. issue and auto-renew Let\'s Encrypt certificate ${os_cert_domain} in IBM Cloud Certificate Manager instance: ${certificate_manager_url}; 2. Deploy the new issued certificate to corresponding environment`
                        } else {
                            purpose_cr = `Auto deploy and rotate openshift domain certificate ${os_cert_domain}`
                            description_cr = `For environment ${env_cert_to_be_updated}, deploy and renew openshift domain certificate ${os_cert_domain} that is issued by Let\'s encrypt`
                        }

                        const data = {
                            assignedto: `${sn_cr_assigned_to_person}`,
                            system: `${sn_cr_system}`,
                            impact: `${impact_cr}`,
                            outageduration: `${sn_cr_outageduration}`,
                            priority: `${sn_cr_priority}`,
                            environment: `${sn_cr_env}`,
                            purpose: `${purpose_cr}`,
                            description: `${description_cr}`,
                            backoutplan: `${sn_cr_backoutplan}`,
                            plannedstart: `${sn_cr_plannedstart}`,
                            plannedend: `${sn_cr_plannedend}`,
                            deploymentready: `${sn_cr_deploymentready}`,
                            type: `${sn_cr_type}`
                        }

                        const api = axios.create({
                            baseURL,
                            timeout: 10000,
                            headers: {
                              'Authorization': `Bearer ${sn_token}`,
                              'Accept': 'application/json',
                              'Content-Type': 'application/json',
                            }
                        });

                        const request = await api.post('/create', data)
                        console.log(request);
                    }
                    
                    
                } else {
                    //if cert is an app cert, which domain is "*.apps.*.regtech.cloud.ibm.com"
                    let regex_app_cert_domain = /\*\.apps\.\w+\.regtech\.cloud\.ibm\.com/
                    if (regex_app_cert_domain.test(`${cert_domain}`)) {
                        //get the environment name
                        var env_name = cert_domain.split(".", 3)[2]
                        impact_cr = 'FCI UI portal will be unavailable for the period of the maintenance window.'
                        if (decodedNotification.event_type === "cert_renew_failed") {
                            purpose_cr = `Auto-renewal for apps route certificate ${cert_domain} failed in IBM Cloud Certificate Manager, so need to issue new Let\'s encrypt cert for ${os_cert_domain},  import these new certs to $ {certificate_manager_url}, and then deploy these certs to ${env_name}`
                            description_cr = `For environment ${env_name}: 1. issue and auto-renew Let\'s Encrypt certificate ${cert_domain} in IBM Cloud Certificate Manager instance: ${certificate_manager_url}; 2. Deploy the new issued certificate to ${env_name}`

                        } else {
                            purpose_cr = 'Auto deploy and rotate app route certificate *.apps.*.regtech.cloud.ibm.com'
                            description_cr = `For environment ${env_name}, deploy and renew app route certificate ${cert_domain}`
                        }
                        const data = {
                            assignedto: `${sn_cr_assigned_to_person}`,
                            system: `${sn_cr_system}`,
                            impact: `${impact_cr}`,
                            outageduration: `${sn_cr_outageduration}`,
                            priority: `${sn_cr_priority}`,
                            environment: `${sn_cr_env}`,
                            purpose: `${purpose_cr}`,
                            description: `${description_cr}`,
                            backoutplan: `${sn_cr_backoutplan}`,
                            plannedstart: `${sn_cr_plannedstart}`,
                            plannedend: `${sn_cr_plannedend}`,
                            deploymentready: `${sn_cr_deploymentready}`,
                            type: `${sn_cr_type}`
                        }

                        const api = axios.create({
                            baseURL,
                            timeout: 10000,
                            headers: {
                              'Authorization': `Bearer ${sn_token}`,
                              'Accept': 'application/json',
                              'Content-Type': 'application/json',
                            }
                        });

                        const request = await api.post('/create', data)
                        console.log(request);
                    }
                } 
            }
        }
    } catch (err) {
        console.log(err);
    }
}