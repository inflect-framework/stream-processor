const k8s = require('@kubernetes/client-node');
const { Kafka, logLevel } = require('kafkajs');

const BOOTSTRAP_SERVERS = process.env.KAFKA_BOOTSTRAP_SERVERS;
const SASL_USERNAME = process.env.KAFKA_SASL_USERNAME;
const SASL_PASSWORD = process.env.KAFKA_SASL_PASSWORD;

const NAMESPACE = process.env.NAMESPACE;

const kc = new k8s.KubeConfig();
kc.loadFromCluster();
const k8sApi = kc.makeApiClient(k8s.AppsV1Api);

const kafka = new Kafka({
  brokers: [BOOTSTRAP_SERVERS],
  ssl: true,
  sasl: {
    mechanism: 'plain',
    username: SASL_USERNAME,
    password: SASL_PASSWORD,
  },
  logLevel: logLevel.INFO,
});

const admin = kafka.admin();

async function getTopicPartitions(topic) {
  try {
    await admin.connect();
    const metadata = await admin.fetchTopicMetadata({ topics: [topic] });
    return metadata.topics[0].partitions.length;
  } catch (error) {
    console.error(`Error getting partitions for topic ${topic}:`, error);
    return null;
  } finally {
    await admin.disconnect();
  }
}

async function scalePartitions(topic, newPartitionCount) {
  try {
    await admin.connect();
    await admin.createPartitions({
      topicPartitions: [{ topic, count: newPartitionCount }],
    });
    console.log(`Scaled partitions for topic ${topic} to ${newPartitionCount}`);
  } catch (error) {
    console.error(`Error scaling partitions for topic ${topic}:`, error);
  } finally {
    await admin.disconnect();
  }
}

async function main() {
  while (true) {
    try {
      const deployments = await k8sApi.listNamespacedDeployment(NAMESPACE);

      for (const deployment of deployments.body.items) {
        if (deployment.metadata.name.startsWith('pipeline-')) {
          const pipelineId = deployment.metadata.name.split('-')[1];
          const replicaCount = deployment.spec.replicas;

          const topicName = `source_a`

          const currentPartitions = await getTopicPartitions(topicName);

          if (currentPartitions === null) {
            continue;
          }

          if (currentPartitions < replicaCount) {
            console.log(`Scaling up partitions for topic ${topicName} from ${currentPartitions} to ${replicaCount}`);
            await scalePartitions(topicName, replicaCount);
          } else if (currentPartitions > replicaCount) {
            console.warn(`Topic ${topicName} has more partitions (${currentPartitions}) than replicas (${replicaCount}). Manual intervention may be required.`);
          }
        }
      }
    } catch (error) {
      console.error('Error in main loop:', error);
    }

    await new Promise(resolve => setTimeout(resolve, 60000));
  }
}

main().catch(console.error);