/**
 * PLM/ION API Configuration
 * OAuth2.0 credentials for Infor CloudSuite
 */

const PLM_CONFIG = {
  // Tenant Information - TST ENVIRONMENT
  tenantId: 'ATJZAMEWEF5P4SNV_TST',
  clientName: 'BackendServisi',
  
  // OAuth2.0 Credentials - TST
  clientId: 'ATJZAMEWEF5P4SNV_TST~vlWkwz2P74KAmRFfihVsdK5yjnHvnfPUrcOt4nl6gkI',
  clientSecret: 'HU1TUcBOX1rkp-uuYKUQ3simFEYzPKNM-XIyf4ewIxe-TYUZOK7RAlXUPd_FwSZMAslt8I9RZmv23xItVKY8EQ',
  
  // Service Account Keys - TST
  serviceAccountAccessKey: 'ATJZAMEWEF5P4SNV_TST#5d3TLFCMqK_CR9wmWsLbIn1UnLv2d8S0ohtIX4TZ4PUBXyvtx-RjHjscLzfB9NBAGZfdWMgzFt3DCpWoJMOHEg',
  serviceAccountSecretKey: 'g0oBJ4ubPxJwgJZjAxAfguExlH3V5-cFF0zove_9Fb_7h4C67eXko45T9Ltjw-DYzfYUbU_iQbCZuTW6wYeX5Q',
  
  // URLs - TST
  ionApiUrl: 'https://mingle-ionapi.eu1.inforcloudsuite.com',
  providerUrl: 'https://mingle-sso.eu1.inforcloudsuite.com:443/ATJZAMEWEF5P4SNV_TST/as/',
  
  // OAuth2.0 Endpoints
  endpoints: {
    authorization: 'authorization.oauth2',
    token: 'token.oauth2',
    revoke: 'revoke_token.oauth2'
  },
  
  // Other
  delegationType: '12',
  version: '1.1',
  eventVersion: 'V1480769020'
};

module.exports = PLM_CONFIG;

