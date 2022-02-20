import { CloudWatchLogsDecodedData } from '@types'

export const data: CloudWatchLogsDecodedData = {
  messageType: 'DATA_MESSAGE',
  owner: '494887012091',
  logGroup: '/aws/lambda/jokes-api-test-GetRandomFunction-PrtSiiAcVAeL',
  logStream: '2022/02/20/[$LATEST]b7042e80c91145c388058828d969dd54',
  subscriptionFilters: ['jokes-api-test-GetRandomLogGroupSubscription-1QRLTOK13HDJ0'],
  logEvents: [
    {
      id: '36692425850298137280344114119262339486401296848906092546',
      timestamp: 1645345279884,
      message: '2022-02-20T08:21:19.884Z\t39ec1901-4ba2-4ed8-8e5f-e5ea89f15ccc\tERROR\ttesting!\n',
      extractedFields: {
        level: 'ERROR',
        message: 'testing!',
        timestamp: '2022-02-20T08:21:19.884Z',
        uuid: '39ec1901-4ba2-4ed8-8e5f-e5ea89f15ccc',
      },
    },
  ],
}
