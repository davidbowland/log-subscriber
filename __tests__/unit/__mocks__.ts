import { CloudWatchLogsDecodedData } from '@types'
import { ExtractedLogEvent } from '@utils/message-processing'

export const data: CloudWatchLogsDecodedData = {
  logEvents: [
    {
      extractedFields: {
        level: 'ERROR',
        message: 'testing!',
        timestamp: '2022-02-20T08:21:19.884Z',
        uuid: '39ec1901-4ba2-4ed8-8e5f-e5ea89f15ccc',
      },
      id: '36692425850298137280344114119262339486401296848906092546',
      message: '2022-02-20T08:21:19.884Z\t39ec1901-4ba2-4ed8-8e5f-e5ea89f15ccc\tERROR\ttesting!\n',
      timestamp: 1645345279884,
    },
  ],
  logGroup: '/aws/lambda/jokes-api-test-GetRandomFunction-PrtSiiAcVAeL',
  logStream: '2022/02/20/[$LATEST]b7042e80c91145c388058828d969dd54',
  messageType: 'DATA_MESSAGE',
  owner: '494887012091',
  subscriptionFilters: ['jokes-api-test-GetRandomLogGroupSubscription-1QRLTOK13HDJ0'],
}

export const multiEventData: CloudWatchLogsDecodedData = {
  ...data,
  logEvents: [
    ...data.logEvents,
    {
      extractedFields: {
        level: 'ERROR',
        message: 'testing again! <script>',
        timestamp: '2022-02-20T08:21:20.884Z',
        uuid: '5b1c8b76-c0ae-4ca9-9fa8-e1a45ffb2adb',
      },
      id: '36692425850298137280344114119262339486401296848906092547',
      message: '2022-02-20T08:21:20.884Z\t5b1c8b76-c0ae-4ca9-9fa8-e1a45ffb2adb\tERROR\ttesting again! <script>\n',
      timestamp: 1645345280884,
    },
  ],
}

export const extractedEvents: ExtractedLogEvent[] = [
  {
    id: '36692425850298137280344114119262339486401296848906092546',
    level: 'ERROR',
    message: 'testing!',
    timestamp: 1645345279884,
  },
]

export const multipleExtractedEvents: ExtractedLogEvent[] = [
  ...extractedEvents,
  {
    id: '36692425850298137280344114119262339486401296848906092547',
    level: 'ERROR',
    message: 'testing again! <script>',
    timestamp: 1645345280884,
  },
]
