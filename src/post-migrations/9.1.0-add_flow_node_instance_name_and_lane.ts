/* eslint-disable no-null/no-null */
/**
 * At version 9.1.0, the columns "flowNodeLane" and "flowNodenNme" were added to the "FlowNodeInstance" model.
 *
 * This script will retrieve all FlowNodeIntstances from the database, which do not have these properties assigned to them
 * and attempt to fill them out.
 *
 * If the FlowNode belongs to a ProcessModel without lanes, or if it simply was not placed on a lane, the property will remain empty.
 */
import {Logger} from 'loggerhythm';
import {QueryInterface} from 'sequelize';

import {SequelizeConnectionManager} from '@essential-projects/sequelize_connection_manager';
import {BpmnModelParser, ProcessModelFacade} from '@process-engine/process_engine_core';

import * as environment from '../modules/environment';

const logger = Logger.createLogger('processengine:runtime:post_migration_9.1.0');

const connectionManager = new SequelizeConnectionManager();
const parser = new BpmnModelParser();

const nodeEnv = process.env.NODE_ENV || 'sqlite';
const nodeEnvIsPostgres = nodeEnv === 'postgres' || nodeEnv === 'test-postgres';

let correlationDbQueryInterface: QueryInterface;
let flowNodeInstanceDbQueryInterface: QueryInterface;
let processModelDbQueryInterface: QueryInterface;

export async function runPostMigrationForV910(): Promise<void> {
  try {
    logger.info('Running Post Migration...');

    await setup();

    const flowNodeInstancesToUpdate = await getFlowNodeInstancesWithoutNameOrLane();

    if (flowNodeInstancesToUpdate.length === 0) {
      logger.info('Nothing to do here.');

      return;
    }

    await addNameAndLaneToFlowNodeInstances(flowNodeInstancesToUpdate);

    logger.info('Done.');
  } catch (error) {
    logger.error('Failed to execute post-migration script:', error);
    throw error;
  }
}

async function setup(): Promise<void> {

  await parser.initialize();

  // These will only be set, when using SQLite
  const pathToCorrelationDb = process.env.process_engine__correlation_repository__storage;
  const pathToFlowNodeInstanceDb = process.env.process_engine__flow_node_instance_repository__storage;
  const pathToProcessModelDb = process.env.process_engine__process_model_repository__storage;

  correlationDbQueryInterface = await createConnection('correlation_repository.json', pathToCorrelationDb);
  flowNodeInstanceDbQueryInterface = await createConnection('flow_node_instance_repository.json', pathToFlowNodeInstanceDb);
  processModelDbQueryInterface = await createConnection('process_model_repository.json', pathToProcessModelDb);
}

async function createConnection(repository, sqliteStoragePath): Promise<QueryInterface> {

  const config = environment.readConfigFile(nodeEnv, repository);
  config.storage = sqliteStoragePath;

  const sequelizeInstance = await connectionManager.getConnection(config);
  const queryInterface = sequelizeInstance.getQueryInterface();

  return queryInterface;
}

async function getFlowNodeInstancesWithoutNameOrLane(): Promise<any> {

  const querySqlite = 'SELECT * FROM "FlowNodeInstances" WHERE "flowNodeName" IS NULL OR "flowNodeLane" IS NULL';
  const queryPostgres = 'SELECT * FROM public."FlowNodeInstances" AS src; WHERE src."flowNodeName" IS NULL OR src."flowNodeLane" IS NULL';

  const query = nodeEnvIsPostgres ? queryPostgres : querySqlite;

  logger.info('Retrieving all FlowNodeInstances without a name or a lane');

  const flowNodeInstances = (await flowNodeInstanceDbQueryInterface.sequelize.query(query))[0];

  logger.info(`Found ${flowNodeInstances.length} matching FlowNodeInstances`);

  return flowNodeInstances;
}

async function addNameAndLaneToFlowNodeInstances(flowNodeInstances): Promise<void> {

  logger.info('Adding name and lane to each FlowNodeInstance. Depending on the number of records, this may take a while...');

  // for-loops are a lot faster than for...of loops.
  // Since it is very possible that we have to process 10.000+ records here, a for-loop is used to speed things up a bit.
  for (let i = 0; i < flowNodeInstances.length; i++) {

    const flowNodeInstance = flowNodeInstances[i];

    logger.info(`Updating FlowNodeInstance ${flowNodeInstance.flowNodeInstanceId}`);

    const processInstance = await getProcessInstanceById(flowNodeInstance.processInstanceId);
    if (!processInstance) {
      logger.warn(`Processinstance ${flowNodeInstance.processInstanceId} not found. Skipping FlowNodeInstance`);
      continue;
    }

    const processDefinition = await getProcessDefinitionByHash(processInstance.processModelHash);
    if (!processDefinition) {
      logger.warn(`ProcessModel ${processInstance.processModelHash} not found. Skipping FlowNodeInstance`);
      continue;
    }

    const parsedProcessDefinition = await parser.parseXmlToObjectModel(processDefinition.xml);

    const processModel = parsedProcessDefinition.processes[0];
    const processModelFacade = new ProcessModelFacade(processModel);

    logger.info('Retrieving the FlowNodeInstances\' name and lane');
    const flowNodeName = getFlowNodeNameForFlowNodeInstance(flowNodeInstance, processModelFacade);
    const flowNodeLane = getLaneForFlowNodeInstance(flowNodeInstance, processModelFacade);

    await setLaneAndNameForFlowNodeInstance(flowNodeInstance, flowNodeName, flowNodeLane);
  }
}

async function getProcessInstanceById(processInstanceId): Promise<any> {

  const querySqlite = `SELECT * FROM "Correlations" WHERE "processInstanceId" = '${processInstanceId}'`;
  const queryPostgres = `SELECT * FROM public."Correlations" AS src; WHERE src."processInstanceId" = '${processInstanceId}'`;

  const query = nodeEnvIsPostgres ? queryPostgres : querySqlite;

  logger.info(`Querying Processinstance ${processInstanceId}`);
  const processInstances = (await correlationDbQueryInterface.sequelize.query(query))[0];

  if (processInstances.length === 0) {
    return undefined;
  }

  return processInstances[0];
}

async function getProcessDefinitionByHash(hash): Promise<any> {

  const querySqlite = `SELECT * FROM "ProcessDefinitions" WHERE "hash" = '${hash}'`;
  const queryPostgres = `SELECT * FROM public."ProcessDefinitions" AS src; WHERE src."hash" = '${hash}'`;

  const query = nodeEnvIsPostgres ? queryPostgres : querySqlite;

  logger.info(`Querying ProcessModel with hash ${hash}`);
  const processModels = (await processModelDbQueryInterface.sequelize.query(query))[0];

  if (processModels.length === 0) {
    return undefined;
  }

  return processModels[0];
}

function getFlowNodeNameForFlowNodeInstance(flowNodeInstance, processModelFacade): Promise<any> {

  const flowNode = processModelFacade.getFlowNodeById(flowNodeInstance.flowNodeId);

  logger.info(`The FlowNodeInstance belongs to a FlowNode with name ${flowNode.name}`);
  return flowNode.name;
}

function getLaneForFlowNodeInstance(flowNodeInstance, processModelFacade): Promise<any> {

  const processModelHasNoLanes = !processModelFacade.getProcessModelHasLanes();
  if (processModelHasNoLanes) {
    logger.info('The ProcessModel has no lanes');

    return null;
  }

  const laneForFlowNode = processModelFacade.getLaneForFlowNode(flowNodeInstance.flowNodeId);
  if (!laneForFlowNode) {
    logger.info('The FlowNodeInstance was not executed on any lane');

    return null;
  }

  logger.info(`FlowNodeInstance was executed on the lane ${laneForFlowNode.name}`);
  return laneForFlowNode.name;
}

async function setLaneAndNameForFlowNodeInstance(flowNodeInstance, name, lane): Promise<any> {
  logger.info('Updating FlowNodeInstance properties');
  const flowNodeName = name ? name.replace(/'/g, '\'\'') : name;
  const flowNodeLane = lane ? lane.replace(/'/g, '\'\'') : lane;

  const query = `UPDATE "FlowNodeInstances" SET "flowNodeName" = '${flowNodeName}',
   "flowNodeLane" = '${flowNodeLane}' WHERE "id" = ${flowNodeInstance.id}`;

  await flowNodeInstanceDbQueryInterface.sequelize.query(query);
}
