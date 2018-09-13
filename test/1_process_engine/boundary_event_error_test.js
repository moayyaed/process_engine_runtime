'use strict';

const should = require('should');
const TestFixtureProvider = require('../../dist/commonjs').TestFixtureProvider;

describe('Error Boundary Event - ', () => {

  let testFixtureProvider;

  const processModelId = 'boundary_event_error_test';
  const startEventId = 'StartEvent_1';

  before(async () => {
    testFixtureProvider = new TestFixtureProvider();
    await testFixtureProvider.initializeAndStart();

    await testFixtureProvider.importProcessFiles([processModelId]);
  });

  after(async () => {
    await testFixtureProvider.tearDown();
  });

  it('should not alter the execution path, if the node instance, to which the event is attached, was executed successfully.', async () => {

    const initialToken = {
      raiseError: false,
    };

    const useAutoGeneratedCorrelationId = undefined;

    const result = await testFixtureProvider.executeProcess(processModelId, startEventId, useAutoGeneratedCorrelationId, initialToken);

    const expectedTaskResult = /success/i;

    should(result).have.property('tokenPayload');
    should(result.tokenPayload).be.match(expectedTaskResult);
  });

  it('should successfully catch the error, alter the execution path and write the result to the token history.', async () => {

    const initialToken = {
      raiseError: true,
    };

    const useAutoGeneratedCorrelationId = undefined;

    const result = await testFixtureProvider.executeProcess(processModelId, startEventId, useAutoGeneratedCorrelationId, initialToken);

    const expectedTaskResult = /test/i;

    should.exist(result);
    should(result.tokenPayload).be.match(expectedTaskResult);
  });
});