//Background:  This tool can be used to call IBM Cloud Certificate Manager APIs to manager your IBM Cloud Certificates
//i.e., import bulk of certificates to Certificate Manager, delete certificates, update certificates, etc


//prerequisites
//(1) setup nodejs environment, i.e. "brew install node"; then npm install shelljs, fs, https, commander
//(2) store your certificates into your local machine under some specfic directory
//(3) get the  "api_key" of your account, you can follow this doc to get it: https://console.bluemix.net/docs/iam/apikey_iamtoken.html#iamtoken_from_apikey
//(4) fetch service instanceCRN raw string, which you can get from your cert manager service instance dashboard: Settings -> Instance info -> Copy the CRN.
//(5) fetch region name that your cert manager service instance resides, i.e. us-south, eu-gb. 
//(6) Get Certificate CRN from certificate manager instance dashboard

//Note
// (1) The certificates you plan to import must be in PEM format, so it's suggested you leverage openssl command  like "openssl x509 -in <path_of_cert_with_NON_PEM_format> -out <path_of_cert_with_PEM_format>  -outform PEM" to do the conversion before you run this script to import them
// If you have certificates that have formats (i.e., .crt, .cer, .der, etc) other than PEM, this tool can find them and list all the  "openssl" commands that you can use to convert them to PEM before importing the certificates.
// Once you convert all certs to PEM format, you can re-run this script again, that can help you import all those PEM certs to certificate manager instance
// (2)Please Notice that if you re-run this script to import the same local certificates , the existing PEM certs will be imported to cert manager again even if they already exist in cert manager, since cert manager supports several copies of certs co-existing, and cert_name is not a unique key
// if you want to update some certificate, you should use "reimport" function this script provided

// Usage: 
//(1) To import a specific certificate： 
//    node CertificateManager.js -a import -l <cert_file_absolute_path> -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance>  
//(2) To import bunch of certificates under a specific directory:  
//    node CertificateManager.js -a import -l <certs_directory_absolute_path> -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance>
//(3) To reimport (update) existing specific certificate: 
//    node CertificateManager.js -a reimport -l <cert_file_absolute_path> -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance> -c <certificate_CRN>
//(4) To export (download) a specific certificate to local directory: (Note: must have certificate CRN as the parameter)
//    node CertificateManager.js -a export -l <local_directory_absolute_path> -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance> -c <certificate_CRN>
//(5) To export (download) all certificates to local directory: (Note: if no certificate CRN assigned as parameter, means all certs will be exported)
//     node CertificateManager.js -a export -l <local_directory_absolute_path> -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance>
//(6) To delete a specific certificate:  
//    node CertificateManager.js -a delete -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance> -c <certificate_CRN>
//(7) To delete all certificates managed by the certificate manager instance
//    node CertificateManager.js -a purgeAll -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance>
//(8) To list all certificates managed by the certificate manager instance
//    node CertificateManager.js -a list -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance>
//(9) Get metada of certificate repository:  
//    node CertificateManager.js -a meta -k <api_key> -r <region_name_hosting_your_certmgr_instance> -i <CRN_of_your_certmgr_instance>

//library definition
var shell = require('shelljs');
var fs = require('fs');
const https = require('https');
var program = require('commander');

//Once bluemix.net migrated to cloud.ibm.com, need change it
const CM_domain= 'certificate-manager.bluemix.net';

//option parser 
program
    .option('-a, --action [value]', 'Madatory option. must be one of import, reimport, export, delete, purgeAll, list, meta.  The action name for managing certificates, such as importing certs, reimporting certs, list all certs, exporting certs to local directory, deleting specific certs, deleting all certificates, get metadata of certs, etc.', /import|reimport|list|export|delete|purgeAll|list|meta/)
    .option('-l, --loc_cert_dir_file [value]', 'Madatory option only when action is import, reimport, export. local directory under which need importing certs from, or need exporting certs to; OR: local cert file that needs to be imported or reimported')
    .option('-c --certCRN [value]', 'Madatory option only when action is reimport, delete, export. The id or CRN of the specific certificate that you want to reimport, delete or export')
    .option('-k, --api_key [value]', 'Madatory option.  ibm cloud api key, which you can get from this doc: https://console.bluemix.net/docs/iam/apikey_iamtoken.html#iamtoken_from_apikey')
    .option('-r, --region [value]', 'Madatory option. Region hosting your cert manager service instance, i.e. eu-gb, us-south', /us-south|eu-gb|eu-de|au-syd|us-east/)
    .option('-i, --instance_CRN [value]', 'Madatory option. CRN of your cert manager service instance, where you can get from your cert manager service instance dashboard: Settings -> Instance info -> Copy the CRN ')
program.parse(process.argv);

//check the action name of certs management. the action name must be one of import, reimport, list, export, delete, meta. Do some initial validation work on the combination of command options
if (typeof program.action === 'undefined') {
    console.error('no action name given!');
    program.outputHelp();
    process.exit(1);
}
if (program.action !== 'import' && program.action !== 'reimport' && program.action !== 'export' && program.action !== 'delete' && program.action !== 'purgeAll' && program.action !== 'list' && program.action !== 'meta') {
    console.error('action name must be one of import, reimport, list, export, delete, purgeAll, meta');
    program.outputHelp();
    process.exit(1);
} else {
    //when import, reimport or export certificates, must provide an existing directory or file name
    if (program.action === 'import' || program.action === 'reimport' || program.action === 'export') {
        if (typeof program.loc_cert_dir_file === 'undefined' || !fs.existsSync(program.loc_cert_dir_file)) {
            console.error('for certs import, reimport or export, you must provide an existing directory or an existing cert file');
            program.outputHelp();
            process.exit(1);
        }
    }

    //when reimport, delete or export a certificate, must provide certificate CRN
    if (program.action === 'reimport' || program.action === 'delete') {
        if (typeof program.certCRN === 'undefined') {
            console.error('for cert reimport, delete, you must provide the certificate CRN');
            program.outputHelp();
            process.exit(1);
        }
    }

    // when reimport a certificate, the input parameter must be a certificate file
    if (program.action === 'reimport') {
        if(!fs.statSync(program.loc_cert_dir_file).isFile()){
            console.error('for certs reimport, you must provide an existing cert file');
            program.outputHelp();
            process.exit(1);
        }
    }
    // when export a certificate, the input parameter must be a directory
    if (program.action === 'export') {
        if(!fs.statSync(program.loc_cert_dir_file).isDirectory()){
            console.error('for certs export, you must provide an existing directory');
            program.outputHelp();
            process.exit(1);
        }
    }
}

//check if ibm cloud api key is given
if (typeof program.api_key === 'undefined') {
    console.error('no ibm cloud api key given!');
    program.outputHelp();
    process.exit(1);
}

//check if region name is given and if region name is one of us-south, eu-gb, eu-de, au-syd, us-east
if (typeof program.region === 'undefined') {
    console.error('no region name given!');
    program.outputHelp();
    process.exit(1);
}
if (program.region !== 'us-south' && program.region !== 'eu-gb' && program.region !== 'eu-de' && program.region !== 'au-syd' && program.region !== 'us-east') {
    console.error('region name must be one of us-south, eu-gb, eu-de, au-syd, us-east');
    program.outputHelp();
    process.exit(1);
}

//check if service instanc CRN exists or not
if (typeof program.instance_CRN === 'undefined') {
   console.error('no instance_CRN given!');
   program.outputHelp();
   process.exit(1);
}

//variable definition
var region = program.region;
var instanceCRN = program.instance_CRN;
var apiKey = program.api_key;
var local_cert_dir_file = program.loc_cert_dir_file;
var certCRN = program.certCRN;

//function for importing (or reimporting) single certificate: Currently the cert must be in PEM format
function importSingleCertificate(options, local_cert_file, action_type) {
    var certNamePath = local_cert_file.split(/\.pem/)[0];
    const certName = certNamePath.substring(certNamePath.lastIndexOf("/") + 1, certNamePath.length);
    const cert_content = fs.readFileSync(local_cert_file,'utf8');
    var body;
    //check if private key exist, if it exists, include key as payload as well; if it does not exist, will ignore
    if (fs.existsSync(certNamePath + ".key")) {
        const private_key_content = fs.readFileSync(certNamePath + ".key",'utf8');
        //if action is import, need to include "name: certName" in the body; otherwise for action as reimport, no need to include "name: certName"
        if (action_type === 'import') {
            body = {
            name: certName,
            data: {
                content: cert_content,
                priv_key: private_key_content
            }
            };
        } else {
            body = {
                content: cert_content,
                priv_key: private_key_content
            };
        }
        
    } else {
        if (action_type === 'import') {
            body = {
            name: certName,
            data: {
                content: cert_content
            }
            };
        } else {
            body = {
                content: cert_content
            };
        } 
    }
    //import single certificate by calling Certificate Manager API
    const req = https.request(options, (res) => {
        if(res.statusCode === 200){
            console.log(`${certName} imported successfully`);
        } else {
            console.log(`${certName} failed to be imported with status: ${res.statusCode}`);
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                console.log(`BODY: ${chunk}`);
            });
        }
    });
    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });
    // write data to request body
    req.end(JSON.stringify(body));
}

//function for importing lots of certificates from specific directory, or importing a single certificate by given certificate file
function importCertificates(options, local_cert_dir_file, action_type){
    if(fs.statSync(local_cert_dir_file).isDirectory()) {
        //Check if there are certs are not in PEM format, i.e. crt, cer, der; if there are, notify the user to convert them to PEM before importing the certs from the directory
        shell.ls('-d', local_cert_dir_file).forEach(function (folder) {
            shell.cd(folder);
            var non_pem_flag = 0;
            var files = shell.find('.').filter(function(file) { return file.match(/\.crt$|\.cer$|\.der$/); });
            if (files.length !== 0) {
                files.forEach(function (file) {
                    var certAbsolPath = folder + '/' + file;
                    var certNamePath = file.split(/\.crt|\.cer|\.der/)[0];
                    //const certName = certNamePath.substring(certNamePath.lastIndexOf("/") + 1, certNamePath.length);
                    if (!(fs.existsSync(certNamePath + ".pem"))) {
                        non_pem_flag = 1;
                        var pemcertAbsolPath = folder + '/' +  certNamePath + '.pem'
                        console.log(`openssl x509 -in ${certAbsolPath} -out ${pemcertAbsolPath} -outform PEM`);
                    }
                })
            }
            if (non_pem_flag === 1) {
                console.log('NON-PEM certs exist, need to run above openssl commands to convert them to PEM format before importing');
                process.exit(1);
            }
        });

        //Check if there are certs are in PEM format, if no, will exit
        shell.ls('-d', local_cert_dir_file).forEach(function (folder) {
            shell.cd(folder);
            var files = shell.find('.').filter(function(file) { return file.match(/\.pem$/); });
            if (files.length === 0) {
                console.log(`NO pem certs detected under directory ${local_cert_dir_file} !!`);
                process.exit(1);
            }
        });

        //import PEM certificates by calling function importSingleCertificate in a loop
        shell.ls('-d', local_cert_dir_file).forEach(function (folder) {
            shell.cd(folder);
            var files = shell.find('.').filter(function(file) { return file.match(/\.pem$/); });
            if (files.length !== 0) {
                files.forEach(function (file) {
                    importSingleCertificate(options, file, action_type);
                })
            }
        });

    } else {
        //if the cert is not a PEM file, then need warn the user to convert the cert to PEM format before reimport it
        if(local_cert_dir_file.indexOf('.pem') <= -1) {
            var certNamePath = local_cert_dir_file.split(/\.crt|\.cer|\.der/)[0];
            var certPemPath = certNamePath + ".pem";
            console.log('You need to run following openssl command to convert the cert to PEM format before importing it');
            console.log(`openssl x509 -in ${local_cert_dir_file} -out ${certPemPath} -outform PEM`);
            process.exit(1);
        } // if the cert is in PEM format, just import it
        else {
            importSingleCertificate(options, local_cert_dir_file, action_type);
        }
    }
}

//function for reimporting (update) specific certificate. Input parameters: options payload, target certificate's CRN, and the source local certificate that you want to reimport
function reimportCertificate(options, local_cert_file, action_type) {
    if(local_cert_file.indexOf('.pem') <= -1) {
            var certNamePath = local_cert_file.split(/\.crt|\.cer|\.der/)[0];
            var certPemPath = certNamePath + ".pem";
            console.log('You need to run following openssl command to convert the cert to PEM format before reimporting it');
            console.log(`openssl x509 -in ${local_cert_file} -out ${certPemPath} -outform PEM`);
            process.exit(1);
        } // if the cert is in PEM format, just import it
        else {
            importSingleCertificate(options, local_cert_file, action_type);
        }

}

//function for deleting specific certificate. Input parameters: options payload
function deleteCertificate(options, certCRN) {
     const req = https.request(options, (res) => {
        if(res.statusCode === 200){
            console.log(`cert (CRN: ${certCRN}) deleted successfully`);
        } else {
            console.log(`cert (CRN: ${certCRN})failed to be deleted with status: ${res.statusCode}`);
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                console.log(`BODY: ${chunk}`);
            });
        }
    });
    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });
    req.end();
}

//function for exporting(Get) specific certificate to local directory. Input parameters: options payload, local directory to store the cert
function exportCertificate(options, local_cert_dir_file) {
    var str = '';
    var json_arr = {};
    shell.ls('-d', local_cert_dir_file).forEach(function (folder) {
            shell.cd(folder);
            const req = https.request(options, (res) => {
                if(res.statusCode === 200){
                    res.setEncoding('utf8');
                    res.on('data', function(chunk) {
                        str += chunk;
                    });
                    res.on('end', function() {
                        json_arr = JSON.parse(str);
                        var cert_name = json_arr.name;
                        var cert_content = json_arr.data.content;
                        var key_content = json_arr.data.priv_key;
                        fs.writeFile(local_cert_dir_file + '/' + `${cert_name}.pem`, cert_content, 'utf8', function (err) {
                            if (err) {
                                return console.log(err);
                            }
                            console.log(`cert ${cert_name} exported to ${local_cert_dir_file}`);
                        });

                        if ( typeof key_content !== 'undefined' ) {
                            if(key_content.trim()) {
                                fs.writeFile(local_cert_dir_file + '/' + `${cert_name}.key`, key_content, 'utf8', function (err) {
                                    if (err) {
                                        return console.log(err);
                                    }
                                    console.log(`key for cert ${cert_name} exported to ${local_cert_dir_file}`);
                                });
                            }
                        }
                        
                    });
                } else {
                    console.log(`cert(s) failed to be exported to ${local_cert_dir_file} with status: ${res.statusCode}`);
                    res.setEncoding('utf8');
                    res.on('data', (chunk) => {
                        console.log(`BODY: ${chunk}`);
                    });
                }
            });
            req.on('error', (e) => {
                console.error(`problem with request: ${e.message}`)
            });
            req.end();      
    });
}

//function for retrieving a list of all certificates and their associated metadata. 
function listCertificates(options) {
    var str = '';
    var json_arr = [];
    const req = https.request(options, (res) => {
        if(res.statusCode === 200){
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                str += chunk;
            });
            res.on('end', function() {
                json_arr = JSON.parse(str);
                console.log(str);
            });
        } else {
            console.log(`failed to list certificates with status: ${res.statusCode}`);
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                console.log(`BODY: ${chunk}`);
            });
        }
    });
    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });
    req.end();

}

//function for retrieving the CRNs for all the certificates, which can be used as a callback when deleting all certificates, or export all certificates to local machine
function getAllCertificatesCRNs(options, callback) {
    var str = '';
    var json_arr = [];
    var certs_CRNs_arr = [];
    const req = https.request(options, (res) => {
        if(res.statusCode === 200){
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                str += chunk;
            });
            res.on('end', function() {
                json_arr = JSON.parse(str);
                var total_num_certs = json_arr.totalScannedDocs;
                if (total_num_certs > 0) {
                    for (var i = 0; i < total_num_certs; i++) {
                        certs_CRNs_arr[i] = json_arr.certificates[i]._id;
                    }
                    callback(certs_CRNs_arr);
                }
            });
        } else {
            console.log(`failed to list certificates with status: ${res.statusCode}`);
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                console.log(`BODY: ${chunk}`);
            });
        }
    });
    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });
    req.end();
}


//function for retrieving metadata of the certificates repository. The total number of certificates, the number of expired certificates, and the number of certificates expiring in the next 30 days.
function getCertsMetadata(options) {
    var str = '';
    const req = https.request(options, (res) => {
        if(res.statusCode === 200){
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                str += chunk;
            });
            res.on('end', function() {
                console.log(`successfully get certificates repository metadata as following: ${str}`);
            });
        } else {
            console.log(`failed to get certificates repository metadata with status: ${res.statusCode}`);
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                console.log(`BODY: ${chunk}`);
            });
        }
    });
    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });
    req.end();
}


//Main block

//get iam access token by given apikey
const iam_options = {
  protocol: 'https:',
  hostname: 'iam.bluemix.net',
  port: 443,
  path: '/identity/token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json'
  }
};
var iam_token_body = `grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=${apiKey}`;
var str = '';
var iam_access_token = '';
var json_arr = {};
var options = {};

//function to get iam_access_token and provide the callback to get the returned value of iam token
function get_iam_access_token(options, callback){
    const iam_token_req = https.request(options, (res) => {
        if(res.statusCode === 200){
            res.setEncoding('utf8');
            res.on('data', function(chunk) {
                str += chunk;
            });
            res.on('end', function() {
                json_arr = JSON.parse(str);
                callback(json_arr.access_token);
            });
        } else {
            console.log(`failed to get iam token with status: ${res.statusCode}`);
            res.setEncoding('utf8');
            res.on('data', (data) => {
                console.log(`BODY: ${data}`);
            });
        }
    });
    iam_token_req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});
    // write data to request body
    iam_token_req.end(iam_token_body);
}

function generateOptions(CM_cluster_url, request_path, iam_access_token, request_method) {
    options = {protocol: 'https:',
    hostname: CM_cluster_url,
    port: 443,
    path: request_path,
    method: request_method,
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${iam_access_token}`
    }
    };
    return options;
}

//call the callback to generate the iam access token, and do the corresponding actions i.e.  importing certs, list certs, delete certs, etc
get_iam_access_token(iam_options, function(iam_access_token){
    request_path = '';
    CM_cluster_url = `${region}.${CM_domain}`;
    switch (program.action) {
        case "import":
            request_path = `/api/v3/${encodeURIComponent(instanceCRN)}/certificates/import`;
            options = generateOptions(CM_cluster_url, request_path, iam_access_token, 'POST');
            importCertificates(options, local_cert_dir_file, 'import');
            break;
        case "reimport":
            request_path = `/api/v1/certificate/${encodeURIComponent(certCRN)}`;
            options = generateOptions(CM_cluster_url, request_path, iam_access_token, 'PUT');
            reimportCertificate(options, local_cert_dir_file, 'reimport');
            break;
        case "export":
            if ( certCRN !== "" && typeof certCRN !== 'undefined' ) {
                request_path = `/api/v2/certificate/${encodeURIComponent(certCRN)}`;
                options = generateOptions(CM_cluster_url, request_path, iam_access_token, 'GET');
                exportCertificate(options, local_cert_dir_file);
            } else {
                var certs_CRNs_arr = [];
                var list_request_path = `/api/v2/${encodeURIComponent(instanceCRN)}/certificates`;
                list_options = generateOptions(CM_cluster_url, list_request_path, iam_access_token, 'GET');
                getAllCertificatesCRNs(list_options, function (certs_CRNs_arr){
                    if (certs_CRNs_arr.length > 0) {
                        certs_CRNs_arr.forEach(function (cert_crn) {
                            var exportAll_request_path = `/api/v2/certificate/${encodeURIComponent(cert_crn)}`;
                            export_options = generateOptions(CM_cluster_url, exportAll_request_path, iam_access_token, 'GET');
                            exportCertificate(export_options, local_cert_dir_file);
                        })
                    }
                });
            }
            break;
        case "delete":
            request_path = `/api/v2/certificate/${encodeURIComponent(certCRN)}`;
            options = generateOptions(CM_cluster_url, request_path, iam_access_token, 'DELETE');
            deleteCertificate(options, `${encodeURIComponent(certCRN)}`);
            break;
        case "purgeAll":
            var certs_CRNs_arr = [];
            var list_request_path = `/api/v2/${encodeURIComponent(instanceCRN)}/certificates`;
            list_options = generateOptions(CM_cluster_url, list_request_path, iam_access_token, 'GET');
            getAllCertificatesCRNs(list_options, function (certs_CRNs_arr){
                if (certs_CRNs_arr.length > 0) {
                    certs_CRNs_arr.forEach(function (cert_crn) {
                        var delete_request_path = `/api/v2/certificate/${encodeURIComponent(cert_crn)}`;
                        delete_options = generateOptions(CM_cluster_url, delete_request_path, iam_access_token, 'DELETE');
                        deleteCertificate(delete_options, `${encodeURIComponent(cert_crn)}`);
                    })
                }
            });
            break;
        case "list":
            request_path = `/api/v2/${encodeURIComponent(instanceCRN)}/certificates`;
            options = generateOptions(CM_cluster_url, request_path, iam_access_token, 'GET');
            listCertificates(options);
            break;
        case "meta":
            request_path = `/api/v2/${encodeURIComponent(instanceCRN)}/certificates/metadata`;
            options = generateOptions(CM_cluster_url, request_path, iam_access_token, 'GET');
            getCertsMetadata(options);
            break;
        default:
            console.log('unsupported cert management action');
    }
});
