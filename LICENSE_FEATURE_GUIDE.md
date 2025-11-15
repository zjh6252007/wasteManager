# Driver License Feature Guide

## Overview

The customer management system now includes driver license photo capture and license number recording functionality. This feature helps maintain proper identification records for customers.

## New Features

### 1. Driver License Number Input
- **Field**: Driver License Number input field in customer creation form
- **Purpose**: Record the customer's driver license number for identification
- **Validation**: Text input with placeholder guidance

### 2. Driver License Photo Capture
- **Camera Integration**: Uses the same camera system as biometric capture
- **Photo Quality**: High-resolution photo capture for clear license reading
- **Storage**: Photos are stored securely in the biometric data directory

## How to Use

### Creating a New Customer with License Information

1. **Navigate to Customer Management**
   - Click on "Customer Management" tab
   - Fill in basic customer information (name, phone, address)

2. **Enter License Number**
   - In the "Driver License Number" field
   - Enter the customer's driver license number
   - This field is optional but recommended for identification

3. **Capture License Photo**
   - Click "📷 Capture License Photo" button
   - Camera interface will open
   - Position the driver license clearly in the camera view
   - Click "Take Photo" to capture
   - Photo will be automatically saved

4. **Review and Save**
   - Review all information including license details
   - Click "Add Customer" to save the complete record

### License Photo Management

#### Capturing Photos
- **Clear View**: Ensure the license is well-lit and clearly visible
- **Full License**: Capture the entire license, not just a portion
- **Stable Position**: Hold the license steady during capture
- **Good Lighting**: Use adequate lighting for clear text reading

#### Photo Status
- **Captured**: Green checkmark with "License photo captured" message
- **Remove**: Click "Remove" button to delete the photo
- **Retake**: Click "Capture License Photo" again to retake

## Technical Implementation

### Database Changes
```sql
-- Added to customers table
license_number TEXT,
license_photo_path TEXT
```

### File Storage
- **Location**: `userData/biometric_data/`
- **Naming**: `face_[customerId]_[timestamp].jpg`
- **Format**: JPEG with 80% quality
- **Size**: Typically 50-200KB per photo

### API Integration
- **License Photo Save**: `window.electronAPI.license.savePhoto(customerId, imageData)`
- **Customer Creation**: Includes license fields in customer data
- **Photo Path**: Stored in customer record for future reference

## User Interface

### Customer Creation Form
```
┌─────────────────────────────────────┐
│ Customer Name: [________________]   │
│ Phone Number:  [________________]   │
│ Address:       [________________]   │
│ License Number: [________________]  │
│                                     │
│ Driver License Photo                │
│ ┌─────────────────────────────────┐ │
│ │ [📷 Capture License Photo]       │ │
│ │ ✅ License photo captured [Remove]│ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Add Customer]                      │
└─────────────────────────────────────┘
```

### Camera Interface
- **Title**: "Photo Recognition"
- **Preview**: Live camera feed
- **Controls**: Take Photo / Cancel buttons
- **Quality**: High-resolution capture

## Data Security

### Privacy Protection
- **Local Storage**: All photos stored locally on device
- **No Cloud Upload**: Photos never leave the local system
- **Encrypted Storage**: Files stored in secure biometric directory
- **Access Control**: Only authorized users can access photos

### Data Retention
- **Retention Period**: Follows system data retention settings
- **Backup**: Included in system backups if enabled
- **Deletion**: Photos deleted when customer record is removed

## Best Practices

### Photo Quality
1. **Lighting**: Use good lighting for clear text visibility
2. **Position**: Hold license flat and straight
3. **Distance**: Keep camera at appropriate distance
4. **Stability**: Avoid camera shake during capture

### Data Management
1. **Regular Backups**: Include license photos in backup procedures
2. **Storage Monitoring**: Monitor disk space usage
3. **Access Logs**: Track who accesses license photos
4. **Compliance**: Follow local privacy regulations

### Customer Experience
1. **Clear Instructions**: Guide customers on license positioning
2. **Privacy**: Explain how photos are stored and used
3. **Quality Check**: Verify photo quality before saving
4. **Retake Option**: Allow easy photo retaking if needed

## Troubleshooting

### Common Issues

#### Camera Not Working
- **Check Permissions**: Ensure camera permissions are granted
- **Device Connection**: Verify camera is properly connected
- **Driver Issues**: Update camera drivers if needed
- **Restart**: Try restarting the application

#### Photo Quality Issues
- **Lighting**: Improve lighting conditions
- **Focus**: Ensure camera is focused on license
- **Distance**: Adjust camera distance
- **Stability**: Use stable surface or tripod

#### Storage Issues
- **Disk Space**: Check available disk space
- **Permissions**: Verify write permissions to storage directory
- **Path Issues**: Check file path configuration
- **Corruption**: Verify file integrity

### Error Messages
- **"Failed to save license photo"**: Check storage permissions and space
- **"Camera not available"**: Verify camera connection and permissions
- **"Photo capture failed"**: Check camera functionality and retry

## Compliance Notes

### Legal Considerations
- **Privacy Laws**: Ensure compliance with local privacy regulations
- **Data Protection**: Follow data protection guidelines
- **Consent**: Obtain customer consent for photo storage
- **Retention**: Follow legal requirements for data retention

### Security Measures
- **Access Control**: Limit access to authorized personnel only
- **Encryption**: Consider encrypting stored photos
- **Audit Trail**: Maintain logs of photo access
- **Secure Deletion**: Properly delete photos when no longer needed

## Future Enhancements

### Planned Features
1. **OCR Integration**: Automatic text extraction from license photos
2. **Validation**: Automatic license number validation
3. **Expiry Tracking**: License expiration date monitoring
4. **Batch Processing**: Multiple license photo processing

### Technical Improvements
1. **Image Processing**: Automatic image enhancement
2. **Format Support**: Support for different license formats
3. **Cloud Integration**: Optional cloud storage for photos
4. **Mobile Support**: Mobile app integration

## Support

For technical support or questions about the license feature:
1. Check the troubleshooting section above
2. Review system logs for error details
3. Contact technical support team
4. Refer to system documentation
