// Test file to check if imports work
import PostingService from './services/accounting/posting-service';
import VarianceMonitoringService from './services/accounting/variance-monitoring-service';
import NotificationService from './services/accounting/notification-service';

// Test that we can access the classes
const test = () => {
  console.log('Imports successful');
  console.log(PostingService);
  console.log(VarianceMonitoringService);
  console.log(NotificationService);
};

test();