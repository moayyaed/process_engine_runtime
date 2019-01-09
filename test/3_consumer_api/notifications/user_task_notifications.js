'use strict';

const should = require('should');
const uuid = require('uuid');

const TestFixtureProvider = require('../../../dist/commonjs').TestFixtureProvider;
const ProcessInstanceHandler = require('../../../dist/commonjs').ProcessInstanceHandler;

describe('Consumer API:   Receive User Task Notifications', () => {

  let processInstanceHandler;
  let testFixtureProvider;

  let defaultIdentity;

  const processModelId = 'test_consumer_api_usertask';
  let correlationId = uuid.v4();
  let userTaskToFinish;

  before(async () => {
    testFixtureProvider = new TestFixtureProvider();
    await testFixtureProvider.initializeAndStart();
    defaultIdentity = testFixtureProvider.identities.defaultUser;

    const processModelsToImport = [processModelId];

    await testFixtureProvider.importProcessFiles(processModelsToImport);

    processInstanceHandler = new ProcessInstanceHandler(testFixtureProvider);
  });

  after(async () => {
    await testFixtureProvider.tearDown();
  });

  it('should send a notification when user task is suspended', async () => {

    correlationId = uuid.v4();

    return new Promise(async (resolve, reject) => {

      const notificationReceivedCallback = async (userTaskWaitingMessage) => {

        should.exist(userTaskWaitingMessage);
        // Store this for use in the second test, where we wait for the manualTaskFinished notification.
        userTaskToFinish = userTaskWaitingMessage;

        const userTaskList = await testFixtureProvider
          .consumerApiClientService
          .getUserTasksForProcessModel(defaultIdentity, processModelId);

        const listContainsUserTaskIdFromMessage = userTaskList.userTasks.some((userTask) => {
          return userTask.id === userTaskWaitingMessage.flowNodeId;
        });

        should(listContainsUserTaskIdFromMessage).be.true();

        resolve();
      };

      testFixtureProvider.consumerApiClientService.onUserTaskWaiting(defaultIdentity, notificationReceivedCallback);

      await processInstanceHandler.startProcessInstanceAndReturnCorrelationId(processModelId, correlationId);
    });
  });

  it('should send a notification when user task is finished', async () => {

    return new Promise(async (resolve, reject) => {

      let notificationReceived = false;

      const notificationReceivedCallback = async (userTaskFinishedMessage) => {
        should(userTaskFinishedMessage).not.be.undefined();
        should(userTaskFinishedMessage.flowNodeId).be.equal(userTaskToFinish.flowNodeId);
        should(userTaskFinishedMessage.processModelId).be.equal(userTaskToFinish.processModelId);
        should(userTaskFinishedMessage.correlationId).be.equal(userTaskToFinish.correlationId);
        notificationReceived = true;
      };

      testFixtureProvider.consumerApiClientService.onUserTaskFinished(defaultIdentity, notificationReceivedCallback);

      const processFinishedCallback = () => {
        if (!notificationReceived) {
          throw new Error('Did not receive the expected notification about the finished ManualTask!');
        }
        resolve();
      };
      processInstanceHandler.waitForProcessInstanceToEnd(correlationId, processModelId, processFinishedCallback);
      finishWaitingUserTask();
    });
  });

  it('should send a notification when a UserTask for the given identity is suspended', async () => {

    correlationId = uuid.v4();

    return new Promise(async (resolve, reject) => {

      const notificationReceivedCallback = async (userTaskWaitingMessage) => {

        should.exist(userTaskWaitingMessage);
        should(userTaskWaitingMessage.processInstanceOwner).be.eql(defaultIdentity);
        // Store this for use in the second test, where we wait for the manualTaskFinished notification.
        userTaskToFinish = userTaskWaitingMessage;

        const userTaskList = await testFixtureProvider
          .consumerApiClientService
          .getUserTasksForProcessModel(defaultIdentity, processModelId);

        const listContainsUserTaskIdFromMessage = userTaskList.userTasks.some((userTask) => {
          return userTask.id === userTaskWaitingMessage.flowNodeId;
        });

        should(listContainsUserTaskIdFromMessage).be.true();

        resolve();
      };

      testFixtureProvider.consumerApiClientService.onUserTaskForIdentityWaiting(defaultIdentity, notificationReceivedCallback);

      await processInstanceHandler.startProcessInstanceAndReturnCorrelationId(processModelId, correlationId);
    });
  });

  it('should send a notification when a UserTask for the given identity is finished', async () => {

    return new Promise(async (resolve, reject) => {

      let notificationReceived = false;

      const notificationReceivedCallback = async (userTaskFinishedMessage) => {
        should(userTaskFinishedMessage).not.be.undefined();
        should(userTaskFinishedMessage.flowNodeId).be.equal(userTaskToFinish.flowNodeId);
        should(userTaskFinishedMessage.processModelId).be.equal(userTaskToFinish.processModelId);
        should(userTaskFinishedMessage.correlationId).be.equal(userTaskToFinish.correlationId);
        should(userTaskFinishedMessage.processInstanceOwner).be.eql(defaultIdentity);
        notificationReceived = true;
      };

      testFixtureProvider.consumerApiClientService.onUserTaskForIdentityFinished(defaultIdentity, notificationReceivedCallback);

      const processFinishedCallback = () => {
        if (!notificationReceived) {
          throw new Error('Did not receive the expected notification about the finished ManualTask!');
        }
        resolve();
      };
      processInstanceHandler.waitForProcessInstanceToEnd(correlationId, processModelId, processFinishedCallback);
      finishWaitingUserTask();
    });
  });

  async function finishWaitingUserTask() {
    const userTaskResult = {
      formFields: {
        Form_XGSVBgio: true,
      },
    };

    const processInstanceId = userTaskToFinish.processInstanceId;
    const userTaskInstanceId = userTaskToFinish.flowNodeInstanceId;

    await testFixtureProvider
      .consumerApiClientService
      .finishUserTask(defaultIdentity, processInstanceId, userTaskToFinish.correlationId, userTaskInstanceId, userTaskResult);
  }

});
