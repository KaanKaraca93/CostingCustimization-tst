const axios = require('axios');
const tokenService = require('./tokenService');
const PLM_CONFIG = require('../config/plm.config');

/**
 * PLM API Service
 * Handles all PLM/ION API requests
 */
class PLMService {
  constructor() {
    this.baseUrl = `${PLM_CONFIG.ionApiUrl}/${PLM_CONFIG.tenantId}/FASHIONPLM/odata2/api/odata2`;
  }

  /**
   * Get Style Costing data by StyleId
   * @param {string|number} styleId - Style ID (ModuleId from XML)
   * @returns {Promise<Object>} Style costing data
   */
  /**
   * Generic method to fetch data from PLM with custom OData query
   * @param {string} odataQuery - Full OData query string
   * @returns {Promise<Object>} Raw response data from PLM
   */
  async getStyleData(odataQuery) {
    try {
      console.log(`📥 Fetching style data with custom query`);

      // Get access token
      const authHeader = await tokenService.getAuthorizationHeader();

      const url = `${this.baseUrl}/STYLE?${odataQuery}`;

      console.log('🔗 Request URL:', url);

      const response = await axios.get(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (response.data) {
        console.log('✅ Style data retrieved successfully');
        return response.data;
      } else {
        console.log('⚠️  No data found');
        return null;
      }

    } catch (error) {
      console.error('❌ Error fetching style data:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      
      throw new Error(`Failed to fetch style data: ${error.message}`);
    }
  }

  async getStyleCosting(styleId) {
    try {
      console.log(`📥 Fetching style costing data for StyleId: ${styleId}`);

      // Get access token
      const authHeader = await tokenService.getAuthorizationHeader();

      // Build the complex OData query
      const query = this.buildStyleCostingQuery(styleId);
      const url = `${this.baseUrl}/STYLE${query}`;

      console.log('🔗 Request URL:', url);

      const response = await axios.get(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.value && response.data.value.length > 0) {
        console.log('✅ Style costing data retrieved successfully');
        return response.data.value[0]; // Return first result
      } else {
        console.log('⚠️  No data found for StyleId:', styleId);
        return null;
      }

    } catch (error) {
      console.error('❌ Error fetching style costing:', error.message);
      
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      
      throw new Error(`Failed to fetch style costing: ${error.message}`);
    }
  }

  /**
   * Build OData query for style costing
   * @param {string|number} styleId 
   * @returns {string} OData query string
   */
  buildStyleCostingQuery(styleId) {
    // Complex $expand with nested filters and selects
    const expandQuery = [
      // STYLECOSTING expansion
      'STYLECOSTING(',
        '$expand=',
          // Style Cost Elements (NO FILTER - get all, we'll filter Type=3 in code)
          'STYLECOSTELEMENTS(',
            '$expand=STYLECOSTINGSUPPLIERVALS',
          '),',
          // Style Cost Suppliers (no $select - get all fields including IsLock)
          'STYLECOSTSUPPLIERS(',
            '$expand=STYLESUPPLIER(',
              '$select=Id,SupplierId,Code,SupplierName',
            ')',
          ');',
        '$select=Id,CostModelId,CurrencyId',
      ')',
    ].join('');

    const colorwaysExpand = 'STYLECOLORWAYS($select=Code,Name,FreeFieldOne;$top=1)';
    
    const extendedFieldsExpand = [
      'STYLEEXTENDEDFIELDVALUES(',
        '$select=StyleId,Id,ExtFldId,NumberValue;',
        '$expand=STYLEEXTENDEDFIELDS($select=Name)',
      ')'
    ].join('');

    const select = '$select=StyleId,StyleCode,BrandId,SubCategoryId,UserDefinedField5Id,RetailPrice,NumericValue2';
    const filter = `$filter=StyleId eq ${styleId}`;

    // Combine all parts - MARKETFIELD3 added to expand
    return `?&$expand=${expandQuery},${colorwaysExpand},${extendedFieldsExpand},MARKETFIELD3($select=Name)&${select}&${filter}`;
  }

  /**
   * Parse style costing response and extract relevant data
   * @param {Object} styleData - Raw style data from API
   * @returns {Object} Parsed costing data
   */
  parseStyleCostingData(styleData) {
    if (!styleData) {
      return null;
    }

    const parsed = {
      styleInfo: {
        styleId: styleData.StyleId,
        styleCode: styleData.StyleCode,
        brandId: styleData.BrandId,
        subCategoryId: styleData.SubCategoryId,
        userDefinedField5Id: styleData.UserDefinedField5Id,
        retailPrice: styleData.RetailPrice || null,
        numericValue2: styleData.NumericValue2 || null // MerchHedef
      },
      colorways: [],
      costing: null,
      costElements: [],
      costSuppliers: [],
      extendedFields: []
    };

    // Parse Colorways (field names are PascalCase from OData)
    if (styleData.StyleColorways && styleData.StyleColorways.length > 0) {
      parsed.colorways = styleData.StyleColorways.map(cw => ({
        code: cw.Code,
        name: cw.Name,
        freeFieldOne: cw.FreeFieldOne
      }));
    }

    // Parse Market Field 3 (for PSF)
    if (styleData.MarketField3 && styleData.MarketField3.Name) {
      // Try to parse PSF as number, fallback to null if not a valid number
      const psfValue = parseFloat(styleData.MarketField3.Name);
      parsed.styleInfo.psf = isNaN(psfValue) ? null : psfValue;
    }

    // Parse Costing (StyleCosting is an array in OData response)
    if (styleData.StyleCosting && styleData.StyleCosting.length > 0) {
      const costing = styleData.StyleCosting[0]; // Take first costing record
      
      parsed.costing = {
        id: costing.Id,
        costModelId: costing.CostModelId,
        currencyId: costing.CurrencyId
      };

      // Parse Cost Elements (include Type and Formula fields)
      if (costing.StyleCostElements) {
        parsed.costElements = costing.StyleCostElements.map(element => ({
          id: element.Id,
          styleCostingId: element.StyleCostingId,
          costLevelId: element.CostLevelId,
          seq: element.Seq,
          code: element.Code,
          name: element.Name,
          value: element.Value,
          type: element.Type, // Type=3 means calculated
          formula: element.Formula || element.Calculation || null, // Formula for Type=3
          supplierValues: element.StyleCostingSupplierVals || []
        }));
      }

      // Parse Cost Suppliers
      if (costing.StyleCostSuppliers) {
        parsed.costSuppliers = costing.StyleCostSuppliers.map(supplier => ({
          id: supplier.Id,
          styleCostingId: supplier.StyleCostingId,
          styleSupplierId: supplier.StyleSupplierId,
          isLock: supplier.IsLock || false, // IsLock field for filtering
          countryId: supplier.CountryId || null, // CountryId for VRG/NAVL calculation
          supplierInfo: supplier.StyleSupplier ? {
            id: supplier.StyleSupplier.Id,
            supplierId: supplier.StyleSupplier.SupplierId,
            code: supplier.StyleSupplier.Code,
            supplierName: supplier.StyleSupplier.SupplierName
          } : null
        }));
      }
    }

    // Parse Extended Fields
    if (styleData.StyleExtendedFieldValues) {
      parsed.extendedFields = styleData.StyleExtendedFieldValues.map(field => ({
        id: field.Id,
        styleId: field.StyleId,
        extFldId: field.ExtFldId,
        numberValue: field.NumberValue,
        fieldName: field.StyleExtendedFields?.Name || null
      }));
    }

    return parsed;
  }

  /**
   * Get and parse style costing data
   * @param {string|number} styleId 
   * @returns {Promise<Object>} Parsed style costing data
   */
  async getAndParseStyleCosting(styleId) {
    const rawData = await this.getStyleCosting(styleId);
    return this.parseStyleCostingData(rawData);
  }

  /**
   * Build OData query for style costing with BOO data
   * @param {number} styleId - Style ID
   * @returns {string} OData query string
   */
  buildStyleBooQuery(styleId) {
    const booExpand = 'StyleBOO($expand=StyleBOLOperation)';
    
    const costingExpand = [
      'STYLECOSTING(',
        '$expand=',
        'STYLECOSTELEMENTS(',
          '$expand=STYLECOSTINGSUPPLIERVALS;',
          '$select=Id,StyleCostingId,CostLevelId,Seq,Code,Name,Value,Type,Formula',
        '),',
        'STYLECOSTSUPPLIERS(',
          '$expand=STYLESUPPLIER($select=Id,SupplierId,Code,SupplierName)',
        ');',
        '$select=Id,CostModelId,CurrencyId',
      ')'
    ].join('');

    const colorwaysExpand = 'STYLECOLORWAYS($select=Code,Name,FreeFieldOne;$top=1)';
    
    const extendedFieldsExpand = [
      'STYLEEXTENDEDFIELDVALUES(',
        '$select=StyleId,Id,ExtFldId,NumberValue;',
        '$expand=STYLEEXTENDEDFIELDS($select=Name)',
      ')'
    ].join('');

    const select = '$select=StyleId,StyleCode,BrandId,SubCategoryId,UserDefinedField5Id,RetailPrice,NumericValue2';
    const filter = `$filter=StyleId eq ${styleId}`;

    return `?&$expand=${booExpand},${costingExpand},${colorwaysExpand},${extendedFieldsExpand}&${select}&${filter}`;
  }

  /**
   * Get style costing data with BOO (Bill of Operations)
   * @param {number} styleId - Style ID
   * @returns {Object} Raw OData response with BOO data
   */
  async getStyleBoo(styleId) {
    try {
      console.log(`🔍 Fetching Style BOO data for StyleId: ${styleId}`);
      
      const query = this.buildStyleBooQuery(styleId);
      const url = `${this.baseUrl}/STYLE${query}`;
      
      console.log('📋 GET URL:', url);

      const authHeader = await tokenService.getAuthorizationHeader();

      const response = await axios.get(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.value && response.data.value.length > 0) {
        console.log('✅ Style BOO data retrieved successfully');
        return response.data.value[0];
      } else {
        console.log('⚠️  No style BOO data found');
        return null;
      }

    } catch (error) {
      console.error('❌ Error fetching style BOO data:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Parse style BOO data to camelCase format
   * @param {Object} styleData - Raw OData style data with BOO
   * @returns {Object} Parsed style data
   */
  parseStyleBooData(styleData) {
    const parsed = this.parseStyleCostingData(styleData);
    
    // Add BOO operations
    if (styleData.StyleBOO && styleData.StyleBOO.length > 0) {
      const boo = styleData.StyleBOO[0];
      parsed.boo = {
        id: boo.Id,
        operations: []
      };
      
      if (boo.StyleBOLOperation) {
        parsed.boo.operations = boo.StyleBOLOperation.map(op => ({
          id: op.Id,
          styleBolId: op.StyleBolId,
          operationListId: op.OperationListId,
          operationId: op.OperationId,
          sequence: op.Sequence,
          subSequence: op.SubSequence,
          cost: op.Cost || 0,
          code: op.Code  // Add Code field for special logic
        }));
      }
    }
    
    return parsed;
  }

  /**
   * Get and parse style BOO data
   * @param {string|number} styleId - Style ID
   * @returns {Promise<Object>} Parsed style BOO data
   */
  async getAndParseStyleBoo(styleId) {
    const rawData = await this.getStyleBoo(styleId);
    if (!rawData) return null;
    return this.parseStyleBooData(rawData);
  }

  /**
   * Build OData query for style costing with BOM data
   * @param {number} styleId - Style ID
   * @returns {string} OData query string
   */
  buildStyleBomQuery(styleId) {
    // Using exact format that works in Postman, with Type and Formula added for calculations
    const bomExpand = 'StyleBOM($expand=BOMLine($select=Id,Quantity,Code,Name,Placement2,PurchasePrice,CurrencyId))';
    
    const costingExpand = 'STYLECOSTING($expand=STYLECOSTELEMENTS($expand=STYLECOSTINGSUPPLIERVALS;$select=Id,StyleCostingId,Code,Name,Value,Type,Formula),STYLECOSTSUPPLIERS($expand=STYLESUPPLIER($select=Id,SupplierId,Code,SupplierName)); $select=Id, CostModelId, CurrencyId)';

    const colorwaysExpand = 'STYLECOLORWAYS($select=Code,Name,FreeFieldOne;$top=1)';
    
    const extendedFieldsExpand = 'STYLEEXTENDEDFIELDVALUES($select=StyleId,Id,ExtFldId,NumberValue; $expand=STYLEEXTENDEDFIELDS($select=Name))';

    const select = '$select=StyleId, StyleCode, BrandId, SubCategoryId, UserDefinedField5Id,RetailPrice,NumericValue2';
    const filter = `$filter=StyleId eq ${styleId}`;

    return `?&$expand=${bomExpand},${costingExpand},${colorwaysExpand},${extendedFieldsExpand}&${select}&${filter}`;
  }

  /**
   * Get style costing data with BOM (Bill of Materials)
   * @param {number} styleId - Style ID
   * @returns {Object} Raw OData response with BOM data
   */
  async getStyleBom(styleId) {
    try {
      console.log(`🔍 Fetching Style BOM data for StyleId: ${styleId}`);
      
      const query = this.buildStyleBomQuery(styleId);
      const url = `${this.baseUrl}/STYLE${query}`;
      
      console.log('📋 GET URL:', url);

      const authHeader = await tokenService.getAuthorizationHeader();

      const response = await axios.get(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.value && response.data.value.length > 0) {
        console.log('✅ Style BOM data retrieved successfully');
        return response.data.value[0];
      } else {
        console.log('⚠️  No style BOM data found');
        return null;
      }

    } catch (error) {
      console.error('❌ Error fetching style BOM data:', error.message);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }

  /**
   * Parse style BOM data to camelCase format
   * @param {Object} styleData - Raw OData style data with BOM
   * @returns {Object} Parsed style data
   */
  parseStyleBomData(styleData) {
    const parsed = this.parseStyleCostingData(styleData);
    
    // Extract dynamic currency rates from extended fields
    // Cost10 → CurrencyId=3 (EUR/USD) rate, Cost14 → CurrencyId=1 rate
    const currencyRates = { 4: 1 }; // TRY always 1
    if (styleData.StyleExtendedFieldValues) {
      for (const field of styleData.StyleExtendedFieldValues) {
        const name = field.StyleExtendedFields?.Name;
        const value = parseFloat(field.NumberValue) || null;
        if (name === 'Cost10' && value) {
          currencyRates[3] = value;
          console.log(`💱 Dynamic rate CurrencyId=3 (Cost10): ${value}`);
        } else if (name === 'Cost14' && value) {
          currencyRates[1] = value;
          console.log(`💱 Dynamic rate CurrencyId=1 (Cost14): ${value}`);
        }
      }
    }
    parsed.currencyRates = currencyRates;

    // Add BOM lines - collect from all StyleBOM entries
    if (styleData.StyleBOM && styleData.StyleBOM.length > 0) {
      parsed.bom = {
        bomLines: []
      };
      
      // Iterate through all StyleBOM entries and collect BOMLines
      for (const bomEntry of styleData.StyleBOM) {
        if (bomEntry.BOMLine && bomEntry.BOMLine.length > 0) {
          const lines = bomEntry.BOMLine.map(line => ({
            id: line.Id,
            quantity: line.Quantity || 0,
            code: line.Code,
            name: line.Name,
            placement2: line.Placement2,  // Multi-select field, comma-separated
            purchasePrice: line.PurchasePrice || 0,
            currencyId: line.CurrencyId
          }));
          parsed.bom.bomLines.push(...lines);
        }
      }
    }
    
    return parsed;
  }

  /**
   * Get and parse style BOM data
   * @param {string|number} styleId - Style ID
   * @returns {Promise<Object>} Parsed style BOM data
   */
  async getAndParseStyleBom(styleId) {
    const rawData = await this.getStyleBom(styleId);
    if (!rawData) return null;
    return this.parseStyleBomData(rawData);
  }
}

// Create singleton instance
const plmService = new PLMService();

module.exports = plmService;

